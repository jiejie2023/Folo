const fs = require("fs")
const path = require("path")
const WebSocket = require("ws")

const port = Number(process.env.FOLO_DEBUG_PORT || 9233)
const outFile = process.argv[2]

if (!outFile) {
  console.error("Usage: node tmp/folo-x-import-export-db.cjs <out.db>")
  process.exit(2)
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

const prepareExpression = `
(async () => {
  const openDb = () => new Promise((resolve, reject) => {
    const request = indexedDB.open("WA_SQLITE", 1);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Failed to open WA_SQLITE"));
  });
  const db = await openDb();
  const rows = [];
  await new Promise((resolve, reject) => {
    const tx = db.transaction(["blocks"], "readonly");
    const store = tx.objectStore("blocks");
    const range = IDBKeyRange.bound(["/follow.db", 0], ["/follow.db", Infinity]);
    const request = store.openCursor(range);
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) return resolve();
      const value = cursor.value;
      rows.push({ offset: value.offset, data: value.data });
      cursor.continue();
    };
    request.onerror = () => reject(request.error);
  });
  db.close();
  rows.sort((a, b) => a.offset - b.offset);
  if (rows.length === 0) {
    throw new Error("No /follow.db blocks found in WA_SQLITE");
  }
  const total = rows.reduce((max, row) => Math.max(max, row.offset + row.data.byteLength), 0);
  const bytes = new Uint8Array(total);
  for (const row of rows) {
    bytes.set(new Uint8Array(row.data), row.offset);
  }
  const chunkSize = 64 * 1024;
  const chunks = [];
  for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) {
    const slice = bytes.subarray(offset, Math.min(bytes.byteLength, offset + chunkSize));
    let binary = "";
    for (let i = 0; i < slice.byteLength; i++) {
      binary += String.fromCharCode(slice[i]);
    }
    chunks.push(btoa(binary));
  }
  globalThis.__codexFoloDbChunks = chunks;
  return {
    blockCount: rows.length,
    byteLength: total,
    chunkCount: chunks.length,
    firstBytes: Array.from(bytes.subarray(0, 16)).map((n) => n.toString(16).padStart(2, "0")).join(""),
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
    const prepared = await client.call("Runtime.evaluate", {
      expression: prepareExpression,
      awaitPromise: true,
      returnByValue: true,
    })
    if (prepared.exceptionDetails) {
      throw new Error(JSON.stringify(prepared.exceptionDetails, null, 2))
    }
    const meta = prepared.result.value
    if (!meta || meta.firstBytes !== "53514c69746520666f726d6174203300") {
      throw new Error(`Exported bytes do not look like SQLite: ${JSON.stringify(meta)}`)
    }

    fs.mkdirSync(path.dirname(outFile), { recursive: true })
    const stream = fs.createWriteStream(outFile)
    for (let index = 0; index < meta.chunkCount; index++) {
      const chunk = await client.call("Runtime.evaluate", {
        expression: `globalThis.__codexFoloDbChunks[${index}]`,
        returnByValue: true,
      })
      const base64 = chunk.result.value
      stream.write(Buffer.from(base64, "base64"))
    }
    await new Promise((resolve) => stream.end(resolve))

    console.log(JSON.stringify({ ...meta, outFile }, null, 2))
  } finally {
    client.close()
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
