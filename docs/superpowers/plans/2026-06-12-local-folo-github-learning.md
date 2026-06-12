# 本地构建 Folo + 学习 GitHub 计划

**目标：**  
把 Folo 在你电脑上跑起来，同时把 GitHub / Git 的基础概念用真实项目学会。我们不只复制命令，还要知道每一步在干什么。

**当前情况：**

- 你的本地项目目录：`D:\Software\jielyfolo`
- 你的 GitHub 仓库：`https://github.com/jiejie2023/Folo`
- 官方 GitHub 仓库：`https://github.com/RSSNext/Folo`
- 当前本地分支：`custom/my-folo`
- 桌面端代码目录：`apps/desktop`
- 项目使用：`pnpm`、`Turbo`、`Vite`、`React`、`Electron`

---

## 先理解整体关系

这个项目现在有三层：

```text
官方仓库 RSSNext/Folo
        ↓ fork
你的仓库 jiejie2023/Folo
        ↓ clone
本地目录 D:\Software\jielyfolo
```

也就是说：

- **官方仓库**：别人维护的原始项目。
- **你的仓库**：你 fork 出来的一份副本，可以随便改。
- **本地目录**：你电脑上的代码，真正写代码和运行项目的地方。

远端名字的意思：

```text
origin   = 你的 GitHub 仓库
upstream = 官方 GitHub 仓库
```

以后：

- 你自己的修改，推到 `origin`
- 官方有更新，从 `upstream` 拉回来

---

## 阶段 1：先学会看 Git 当前状态

这一阶段不改代码，只学习怎么看自己在哪个分支、远端是谁、有没有未提交修改。

### 1. 看当前分支

```powershell
git branch --show-current
```

我们期望看到：

```text
custom/my-folo
```

解释：

`branch` 就是“代码路线”。  
我们不直接在 `dev` 上改，而是在 `custom/my-folo` 上改，这样更安全。

### 2. 看当前有没有修改

```powershell
git status --short --branch
```

你会看到类似：

```text
## custom/my-folo...origin/custom/my-folo
?? docs/superpowers/plans/2026-06-12-local-folo-github-learning.md
```

解释：

- `## custom/my-folo...origin/custom/my-folo`：你当前本地分支对应 GitHub 上的同名分支。
- `??`：表示这是一个 Git 还没管理的新文件。

### 3. 看远端仓库地址

```powershell
git remote -v
```

你应该能看到：

```text
origin   https://github.com/jiejie2023/Folo.git
upstream https://github.com/RSSNext/Folo.git
```

解释：

- `origin` 是你的仓库。
- `upstream` 是官方仓库。

---

## 阶段 2：先把这份中文计划提交到你的仓库

这一步是第一次完整练习：

```text
查看修改 → 暂存修改 → 创建提交 → 推送到 GitHub
```

### 1. 看这次改了什么

```powershell
git diff
```

解释：

`git diff` 用来看“我到底改了哪些内容”。  
以后每次提交前都应该先看一眼。

### 2. 把计划文件加入暂存区

```powershell
git add docs/superpowers/plans/2026-06-12-local-folo-github-learning.md
```

解释：

`git add` 不是上传。  
它的意思是：“我决定把这个文件放进下一次提交里。”

### 3. 创建一次提交

```powershell
git commit -m "docs: add local folo learning plan"
```

解释：

`commit` 是一次代码快照。  
它相当于在本地保存一个明确的版本点。

### 4. 推送到你的 GitHub 仓库

```powershell
git push
```

解释：

`push` 才是上传到 GitHub。  
它会把你的本地提交推到 `origin`，也就是你的 `jiejie2023/Folo`。

---

## 阶段 3：准备本地开发环境

Folo 是前端 / Electron 项目，需要 Node 和 pnpm。

### 1. 检查 Node

```powershell
node --version
```

如果能看到版本号，比如：

```text
v22.x.x
```

就说明 Node 已安装。

### 2. 启用 Corepack

```powershell
corepack enable
```

解释：

Corepack 是 Node 自带的包管理器管理工具。  
这个项目指定使用 `pnpm@10.17.0`，Corepack 可以帮我们自动准备正确版本。

### 3. 准备 pnpm

```powershell
corepack prepare
```

### 4. 检查 pnpm

```powershell
pnpm --version
```

期望是 `10.x`，最好接近项目指定的：

```text
10.17.0
```

---

## 阶段 4：安装项目依赖

在项目根目录执行：

```powershell
pnpm install
```

解释：

这一步会根据 `pnpm-lock.yaml` 下载依赖。  
可以理解成“给项目安装运行需要的零件”。

安装完以后检查状态：

```powershell
git status --short
```

正常情况下：

- `node_modules` 不会出现在 Git 修改里
- `pnpm-lock.yaml` 最好不要变化

如果 `pnpm-lock.yaml` 变了，我们再一起看原因。

---

## 阶段 5：先跑浏览器版 Folo

官方贡献文档推荐先跑浏览器调试模式，因为比 Electron 简单。

进入桌面端目录：

```powershell
cd apps/desktop
```

启动浏览器开发模式：

```powershell
pnpm run dev:web
```

它会打印一个本地地址，比如：

```text
http://localhost:xxxx
```

打开这个地址，就能看到本地跑起来的 Folo 前端界面。

解释：

这一步跑的是 Folo 的前端界面，不是完整桌面壳。  
适合先学习 UI 和页面逻辑。

停止服务：

```text
Ctrl + C
```

---

## 阶段 6：再跑 Electron 桌面端

浏览器版能跑以后，再跑完整桌面端。

回到项目根目录：

```powershell
cd D:\Software\jielyfolo
```

复制环境变量文件：

```powershell
Copy-Item apps/desktop/.env.example apps/desktop/.env
```

打开 `apps/desktop/.env`，确认里面有：

```dotenv
VITE_API_URL=https://api.follow.is
```

然后进入桌面端目录：

```powershell
cd apps/desktop
```

启动 Electron：

```powershell
pnpm run dev:electron
```

解释：

这一步会启动真正的桌面端窗口。  
但它仍然会连接 Folo 官方线上 API，不是完全离线运行。

---

## 阶段 7：做第一个小改动

我们第一次不要动复杂逻辑，只改一个低风险的东西，比如：

- 某个页面标题
- 某个按钮文案
- 某个小样式
- 本地开发标识

先搜索可见文案：

```powershell
rg "Folo|Follow everything|AI RSS" apps/desktop/layer/renderer/src apps/desktop/layer/renderer/public
```

解释：

`rg` 是搜索工具。  
它能帮我们找到代码里某段文字在哪里。

改完以后再运行：

```powershell
cd apps/desktop
pnpm run dev:web
```

如果页面显示你的修改，说明第一次本地改造成功。

---

## 阶段 8：提交你的第一个代码改动

### 1. 看改了什么

```powershell
git diff
```

确认只有你想改的内容。

### 2. 加入暂存区

```powershell
git add 你改过的文件路径
```

例如：

```powershell
git add apps/desktop/layer/renderer/src/xxx.tsx
```

### 3. 提交

```powershell
git commit -m "feat: customize local folo ui"
```

### 4. 推送

```powershell
git push
```

解释：

这时候你的 GitHub fork 上就会有你的自定义改动。

---

## 阶段 9：学习怎么同步官方更新

以后官方 Folo 还会继续更新。你可以这样获取官方最新代码：

```powershell
git fetch upstream
```

解释：

`fetch` 只是“拿到远端信息”，不会直接改你的代码。

查看你和官方 `dev` 的差异：

```powershell
git log --oneline --left-right --graph custom/my-folo...upstream/dev -20
```

如果准备把官方更新合进来：

```powershell
git switch custom/my-folo
git merge upstream/dev
```

如果没有冲突，就可以：

```powershell
git push
```

解释：

这就是：

```text
官方更新 → 拉到本地 → 合并到你的分支 → 推到你的 GitHub 仓库
```

---

## 阶段 10：理解 Release 标签

你之前问过：

> Release 里的桌面端是不是这个仓库构建的？

答案是是的，但 Release 通常对应某个标签，比如：

```text
desktop/v1.9.0
```

查看桌面端版本标签：

```powershell
git tag --list "desktop/v*" --sort=-version:refname
```

如果以后想看 `v1.9.0` 当时的源码，可以临时创建一个单独目录：

```powershell
git worktree add ..\folo-desktop-v1.9.0 desktop/v1.9.0
```

解释：

`dev` 是一直在变的开发分支。  
`desktop/v1.9.0` 是发布那一刻的代码快照。

---

## 我们后续的推荐节奏

建议不要一口气全做完，而是这样来：

1. **先提交这份中文计划**
2. **安装依赖**
3. **跑起来浏览器版**
4. **跑起来 Electron 桌面端**
5. **做第一个小 UI 改动**
6. **提交并推送**
7. **再学同步官方更新**

每一步我都会解释：

- 这个命令在干嘛
- 为什么要这样做
- 出错了怎么看
- GitHub 上对应发生了什么变化

---

## 常用命令小抄

看当前状态：

```powershell
git status
```

看改了什么：

```powershell
git diff
```

把文件放进下一次提交：

```powershell
git add 文件路径
```

创建提交：

```powershell
git commit -m "说明这次改了什么"
```

推送到你的 GitHub：

```powershell
git push
```

从官方仓库获取更新：

```powershell
git fetch upstream
```

把官方更新合进你的分支：

```powershell
git merge upstream/dev
```

---

## 当前第一步

我们下一步建议先做：

```powershell
git status --short --branch
git diff
git add docs/superpowers/plans/2026-06-12-local-folo-github-learning.md
git commit -m "docs: add local folo learning plan"
git push
```

这一步会让你第一次完整体验：

```text
本地新增文件 → 提交 → 推到 GitHub
```
是的