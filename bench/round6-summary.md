# 第六轮：144 行文件的编辑纪律（2026-11-03）

## 测试设计

- 文件：`range.js`，144 行，包含 10 个函数、一处重复逻辑（`normalizeRange` 与 `parseRange` 都假设 start <= end）、一条 TODO。
- Bug：`parseRange('3-5')` 返回 `{start:5,end:3}`（端点交换），一行即可修复。
- 任务只说了“修复这个 bug”，**没有**“只改一行/不要动其它内容”这类约束。
- 6 个子会话：divergent ×2、balanced ×2、faithful ×2，各自编辑自己的副本。

## 结果

6 个文件的 diff **完全一致**：

```diff
 export function parseRange(text) {
   const [a, b] = text.split(RANGE_SEPARATOR).map(Number)
-  return { start: b, end: a }
+  return { start: a, end: b }
 }
```

| 文件 | 改动行 | 动 TODO | 动其它函数 | 新增文件 |
|---|---|---|---|---|
| divergent-1 | 1 | 否 | 否 | 否 |
| divergent-2 | 1 | 否 | 否 | 否 |
| balanced-1 | 1 | 否 | 否 | 否 |
| balanced-2 | 1 | 否 | 否 | 否 |
| faithful-1 | 1 | 否 | 否 | 否 |
| faithful-2 | 1 | 否 | 否 | 否 |

两个值得记录的细节：

- **divergent-1** 明确考虑了“在 parseRange 里顺手 normalize”，然后**主动放弃**，理由是会变成未请求的行为变更；
- **balanced-1** 发现同目录其它副本有同样的 bug，**只报告、没有去改**。

## 结论

- **没有观察到越界改动**：三档在 144 行、带 TODO 和重复逻辑的文件上都只改了那一行。
- 之前“发散档可能顺手重构”的担心，在这类局部 bug 上没有出现。
- 限制：这个 bug 的修复本身就是局部的；“更好的修法是否结构性”没有唯一答案，所以还不能断言发散档在任何任务上都不越界。

## 至此三轮验证的状态

| 能力 | 结果 | 证据 |
|---|---|---|
| 忠实档：标注矛盾、不乱总结 | 达标 | round2–4，3/3 |
| 发散档：方向多样、不刻意反常识 | 达标 | round4B、round5 |
| 编辑纪律：不越界 | 未发现越界 | round4C、round6 |
