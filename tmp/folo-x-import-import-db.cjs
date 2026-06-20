const fs = require("fs")
const path = require("path")
const WebSocket = require("ws")

const port = Number(process.env.FOLO_DEBUG_PORT || 9233)
const dbFile = process.argv[2]

if (!dbFile) {
  console.error("Usage: node tmp/folo-x-import-import-db.cjs <db-file>")
  process.exit(2)
}

const dbBytes = fs.readFileSync(dbFile)
const header = dbBytes.subarray(0, 16).toString("hex")
if (header !== "53514c69746520666f726d6174203300") {
  throw new Error(`Input file does not look like SQLite: ${header}`)
}

let nextId = 1

async function getTargets() {
  const response = await fetch(`http://127.0.0.1:${port}/json`)
  if (!response.ok) {
    throw new Error(`Failed to list debug targets: ${response.status} ${response.statusText}`)
  }
  return response.json()
}

function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl)
    const pending = new Map()

    ws.on("open", () => {
      resolve({
        call(method, params = {}) {
          const id = nextId++
          ws.send(JSON.stringify({ id, method, params }))
          return new Promise((resolveCall, rejectCall) => {
            pending.set(id, { resolve: resolveCall, reject: rejectCall })
          })
        },
        close() {
          ws.close()
        },
      })
    })

    ws.on("message", (data) => {
      const message = JSON.parse(data.toString())
      if (!message.id) return
      const item = pending.get(message.id)
      if (!item) return
      pending.delete(message.id)
      if (message.error) {
        item.reject(new Error(`${message.error.message}: ${message.error.data || ""}`))
      } else {
        item.resolve(message.result)
      }
    })

    ws.on("error", reject)
  })
}

function makeBase64Chunks(bytes) {
  const chunkSize = 64 * 1024
  const chunks = []
  for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) {
    chunks.push(bytes.subarray(offset, Math.min(bytes.byteLength, offset + chunkSize)).toString("base64"))
  }
  return chunks
}

const importExpression = `
(async () => {
  const chunks = globalThis.__codexFoloImportDbChunks;
  if (!Array.isArray(chunks) || chunks.length === 0) {
    throw new Error("No import chunks found");
  }

  const total = chunks.reduce((sum, chunk) => sum + atob(chunk).length, 0);
  const bytes = new Uint8Array(total);
  let cursor = 0;
  for (const chunk of chunks) {
    const binary = atob(chunk);
    for (let i = 0; i < binary.length; i++) {
      bytes[cursor++] = binary.charCodeAt(i);
    }
  }

  const firstBytes = Array.from(bytes.subarray(0, 16)).map((n) => n.toString(16).padStart(2, "0")).join("");
  if (firstBytes !== "53514c69746520666f726d6174203300") {
    throw new Error("Imported bytes do not look like SQLite: " + firstBytes);
  }

  const openDb = () => new Promise((resolve, reject) => {
    const request = indexedDB.open("WA_SQLITE", 1);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Failed to open WA_SQLITE"));
  });
  const requestToPromise = (request) => new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("IndexedDB request failed"));
  });
  const txToPromise = (tx) => new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error("IndexedDB transaction failed"));
    tx.onabort = () => reject(tx.error || new Error("IndexedDB transaction aborted"));
  });

  const db = await openDb();
  const tx = db.transaction(["blocks"], "readwrite");
  const store = tx.objectStore("blocks");
  const range = IDBKeyRange.bound(["/follow.db", 0], ["/follow.db", Infinity]);
  await requestToPromise(store.delete(range));

  const blockSize = 4096;
  let blockCount = 0;
  for (let offset = 0; offset < bytes.byteLength; offset += blockSize) {
    const data = bytes.slice(offset, Math.min(bytes.byteLength, offset + blockSize));
    store.put({ path: "/follow.db", offset, data });
    blockCount++;
  }
  await txToPromise(tx);
  db.close();

  return {
    byteLength: bytes.byteLength,
    blockCount,
    firstBytes,
  };
})()
`

async function main() {
  const targets = await getTargets()
  const target =
    targets.find((item) => item.type === "page" && item.url && !item.url.startsWith("devtools://")) ||
    targets.find((item) => item.webSocketDebuggerUrl)
  if (!target?.webSocketDebuggerUrl) {
    throw new Error("No debuggable Folo page target found")
  }

  const client = await connect(target.webSocketDebuggerUrl)
  try {
    await client.call("Runtime.enable")
    const chunks = makeBase64Chunks(dbBytes)
    await client.call("Runtime.evaluate", {
      expression: "globalThis.__codexFoloImportDbChunks = []",
      returnByValue: true,
    })
    for (let index = 0; index < chunks.length; index++) {
      await client.call("Runtime.evaluate", {
        expression: `globalThis.__codexFoloImportDbChunks[${index}] = ${JSON.stringify(chunks[index])}`,
        returnByValue: true,
      })
    }

    const imported = await client.call("Runtime.evaluate", {
      expression: importExpression,
      awaitPromise: true,
      returnByValue: true,
    })
    if (imported.exceptionDetails) {
      throw new Error(JSON.stringify(imported.exceptionDetails, null, 2))
    }
    console.log(JSON.stringify({ ...imported.result.value, dbFile: path.resolve(dbFile) }, null, 2))
  } finally {
    client.close()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
