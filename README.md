# dsh-creativity-mode

一个给 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)（DSH）用的**会话级工作风格开关**：在同一个会话里切换发散 / 平衡 / 忠实三种风格，不用每次手写“多给几个大胆的想法”或“只做我让你做的事”。

## 它做什么

| 档位 | 行为 |
| --- | --- |
| `divergent` | 给 3–5 个做法不同的方向；检查前提；动手改文件前切到编辑纪律 |
| `balanced`（默认） | 不加额外规则，明确说明“之前的风格作废” |
| `faithful` | 整理资料不加工：保留原文、不总结、矛盾标 `[as written]` 并列入 `## open questions` |

切换方式：输入框左侧的档位按钮、`/creativity` 命令，或直接让 agent 调用 `set_creativity`。

## 怎么实现的

- **不改系统提示词**：系统里只有一段恒定锚，说明“以最近一条 `style` notice 为准”。
- 每次切换在**下一步**注入一条简短的 user-role notice（`balanced` ≈ 50 token，`divergent`/`faithful` ≈ 250 token），并按“当前档位 ≠ 已告知档位”去重。
- 这样切换不会让 `deepseek-flash` 这类 `systemPromptUpdate: in-history` 的模型追加整份系统提示词副本（约 1.7k token/次）。

细节见 [dsh-creativity-mode/README.md](dsh-creativity-mode/README.md)。

## 目录

```
dsh-creativity-mode/   # 插件本体（Host + Client + locale + icon）
bench/                 # 六轮对照实验与盲评的原始产出和报告
bin/pnpm               # 本机的 pnpm 包装脚本（路径与本机绑定，可选）
```

## 安装

```bash
# 在 DSH 里用插件管理器安装本目录
#   target: <repo>/dsh-creativity-mode
# 或手动：
dsh plugin --profile web add <repo>/dsh-creativity-mode
```

安装后重启或重载 profile，输入框左侧会出现档位按钮。

## 测试记录

`bench/` 下有六轮实验：

- round2–4：忠实档的 `open questions` 行为、发散档的方向多样性、编辑纪律；
- round5：去掉“刻意反直觉”措辞后的发散档；
- round6：144 行文件上的编辑纪律（0/6 越界）；
- blind：去标签盲评，两组裁判都正确识别了 balanced 与对应风格。

每份报告都是 `bench/roundN-summary.md` 或 `bench/blind/summary.md`。

## 说明

- 插件包名是 `@local/dsh-creativity-mode`，没有发布到 npm，按本地 bundle 安装。
- `bin/pnpm` 是本机环境（nvm + corepack）的包装脚本，路径写死，仅作参考。
