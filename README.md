# @jany555/image-cli

给 AI Agent 一套处理图片的手。

image-cli 把日常最高频的图片处理操作全部封装成一句话命令，同时为 Cursor、Claude Code 等 AI 工具提供技能包（Skills），让 AI 能主动理解并调用这些能力。

## 功能一览

| 命令 | 功能 | 典型场景 |
|------|------|----------|
| `rmbg` | AI 去背景 | 照片/插画去白底，游戏素材抠图 |
| `crop` | 裁剪 | 封面图、头像裁到固定尺寸 |
| `resize` | 缩放 | 批量压缩到目标宽高或最长边 |
| `convert` | 格式转换 | PNG/JPEG/WebP/AVIF 互转 |
| `webp` | 转 WebP | H5/小程序图片体积优化 |
| `optimize` | 无损压缩 | 发布前压 PNG/WebP 体积 |
| `slice` | 切精灵图 | 把 sprite sheet 切成单独素材 |
| `inspect` | 查看图片信息 | 确认尺寸、格式、色彩空间 |
| `install` | 安装 AI Skills | 把图片技能包装入 AI Agent |
| `update` | 更新到最新版 | 一键升级工具和技能包 |

## 快速开始

无需全局安装，直接用 npx 运行：

```bash
npx @jany555/image-cli --help
```

如果你是 AI Agent（Cursor、Claude Code 等），运行以下命令把图片处理技能安装到本地，之后 AI 可以主动调用这些能力：

```bash
npx @jany555/image-cli install
```

## 场景演示

### 场景 1：游戏素材批量去背景

有一批白底卡通角色图，需要抠成透明底 PNG 直接用于游戏。

```bash
# 单张
npx @jany555/image-cli rmbg "C:\assets\character.png"

# 批量
npx @jany555/image-cli rmbg "C:\assets\characters" --recursive
```

输出文件为同名 `_nobg.png`，透明底 PNG。首次运行会自动下载 FeyNoBg 模型（约 300MB），之后缓存在本地无需重复下载。

> 前置要求：需安装 Python 依赖 `pip install nobg loadimg`

### 场景 2：H5 游戏图片体积优化

发布前批量把 PNG 转成 WebP，显著降低加载体积：

```bash
npx @jany555/image-cli webp "C:\game\assets" --recursive
```

### 场景 3：生成统一尺寸封面图

```bash
npx @jany555/image-cli crop "C:\images\banner.png" --width 750 --height 422
```

### 场景 4：切精灵图

把一张包含多个角色的 sprite sheet 切成独立素材：

```bash
npx @jany555/image-cli slice "C:\assets\sprite.png" --columns 4 --rows 3
```

## 与 AI Agent 配合

image-cli 专为 AI Agent 设计了技能描述（Skills），让 Cursor、Claude Code 等 AI 工具能主动理解并调用这些命令，而不是每次都要你手写命令。

一次安装，永久生效：

```bash
npx @jany555/image-cli install
```

安装完成后，你可以直接对 AI 说：

- "帮我把这张图去掉背景"
- "把 assets 目录下所有 PNG 转成 WebP"
- "把这张图裁成 1:1 正方形"

AI 会自动选择合适的命令和参数执行。

## 完整参数速查

### rmbg — AI 去背景

```bash
npx @jany555/image-cli rmbg <file-or-dir> [--recursive] [--replace] [--output-dir <dir>] [--dry-run]
```

| 参数 | 说明 |
|------|------|
| `--recursive` | 递归处理目录 |
| `--replace` | 处理后删除原图（不可逆，执行前需确认） |
| `--output-dir <dir>` | 输出到指定目录，保持子目录结构 |
| `--dry-run` | 预览计划，不实际写文件 |

> 使用 FeyNoBg 模型，自动检测 GPU（CUDA/MPS），批量处理时模型只加载一次。
> 前置要求：`pip install nobg loadimg`

### crop — 裁剪

```bash
npx @jany555/image-cli crop <file-or-dir> --width <n> --height <n> [--position center] [--recursive] [--output-dir <dir>]
```

### resize — 缩放

```bash
npx @jany555/image-cli resize <file-or-dir> [--width <n>] [--height <n>] [--max-side <n>] [--recursive] [--output-dir <dir>]
```

### convert — 格式转换

```bash
npx @jany555/image-cli convert <file-or-dir> --to <png|jpeg|webp|avif> [--recursive] [--output-dir <dir>]
```

### webp — 转 WebP

```bash
npx @jany555/image-cli webp <file-or-dir> [--recursive] [--replace] [--quality <1-100>] [--skip-larger]
```

### optimize — 无损压缩

```bash
npx @jany555/image-cli optimize <file-or-dir> [--recursive] [--replace] [--include-jpeg]
```

### slice — 切精灵图

```bash
npx @jany555/image-cli slice <file> [--columns <n> --rows <n>] [--tile-width <n> --tile-height <n>] [--output-dir <dir>]
```

### inspect — 查看图片信息

```bash
npx @jany555/image-cli inspect <file-or-dir> [--recursive] [--json]
```

### install — 安装 AI Skills

```bash
npx @jany555/image-cli install [--dir <path>] [--force] [--dry-run]
```

默认安装到 `~/.claude/skills/`，兼容 Claude Code、Cursor 等遵循该路径规范的 AI 工具。

## 保持更新

```bash
npx @jany555/image-cli update
```

## 常见问题

### rmbg 报 fetch failed / 下载超时？

首次运行需要下载 FeyNoBg 模型（约 300MB）。国内网络访问 HuggingFace 可能受限，设置代理后重试：

```bash
$env:HTTPS_PROXY = "http://127.0.0.1:7890"
npx @jany555/image-cli rmbg "your-image.png"
```

### 为什么 rmbg 每张图需要较长时间？

rmbg 使用 FeyNoBg AI 模型做图像分割推理，有 GPU（CUDA/MPS）时自动加速，CPU 模式约 15-20 秒/张属正常。批量处理时模型只加载一次，多张图连续处理效率更高。

### install 安装的 Skills 放在哪里？

默认安装到 `~/.claude/skills/`，兼容 Claude Code、Cursor 等遵循该路径规范的 AI 工具。可用 `--dir` 指定自定义路径。

## 更新日志

### v1.5.0

- `rmbg` 切换为 FeyNoBg 模型（SOTA 背景去除，约 300MB）
- 支持批量推理：多张图只启动一次 Python 子进程，模型只加载一次
- 自动检测 GPU（CUDA / MPS），有 GPU 时推理速度大幅提升
- 移除 `--alpha-matting` 和 `--model` 参数，接口更简洁
- 删除 JS 侧 @huggingface/transformers 依赖，包体积更小

### v1.4.0

- 新增 `update` 命令，一键更新到最新版
- 新增版本更新自动提醒（执行任意命令时后台检测，缓存 24h）

### v1.2.1

- 新增 `install` 命令，将 10 个 image-* skills 打包随 npm 包发布
- 一次安装，AI Agent 即可主动调用所有图片处理能力

### v1.1.0

- 新增 `rmbg` 命令，集成 AI 去背景模型
- 支持 HTTPS_PROXY 代理，默认走 hf-mirror.com 国内镜像

### v1.0.0

- 初始发布，包含 convert / webp / resize / crop / optimize / inspect / slice 七个命令

## License

MIT

---

## 维护说明（开发者）

每次发版前需同步更新以下文档：

- **飞书文档**：[image-cli 使用文档](https://dodjoyfs.feishu.cn/docx/XXGVdR931ohkfex8h0McqJD1noc)

更新内容包括：功能变更、参数变化、更新日志新增版本条目。

