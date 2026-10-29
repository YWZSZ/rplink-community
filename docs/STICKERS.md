# 表情包格式

通用版不附带素材；你需要自己准备图片，并确认版权。

## 目录

```text
plugin/assets/stickers/
  my_pack/
    stickers.json
    001.png
    002.png
```

`plugin/assets/stickers/` 已被 `.gitignore` 排除。

## stickers.json

```json
{
  "character": "可选的说明",
  "stickers": [
    {
      "id": "001",
      "file": "001.png",
      "tags": ["开心", "笑", "happy", "smile"],
      "description": "开心地笑"
    }
  ]
}
```

- `file` 可以是 png/jpg/jpeg/webp/gif；
- `tags` 用于匹配 AI 输出的 `[[STICKER: 标签]]`；
- 每张图至少一个标签。

## 在角色卡里启用

角色卡：

```json
{
  "stickers": {
    "enabled": true,
    "pack": "my_pack",
    "maxPerReply": 3
  }
}
```

AI 会在回复里输出：

```text
[[STICKER: 开心]]
```

服务端校验标签后发送对应图片。
