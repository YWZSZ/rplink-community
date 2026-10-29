# 生图 provider 接口

RPLink 通用版不包含生图后端，只调用一个你配置的 HTTP 服务。

## 配置

在 `plugin/cordis.patch.yml` 中：

```yaml
imageProvider:
  url: 'http://127.0.0.1:9000/generate'
  token: ''          # 可选，作为 Authorization: Bearer <token>
  timeoutMs: 360000  # 可选
```

或在 RPLink 设置中填写。

## 请求

RPLink 会向 `url` 发送：

```http
POST /generate
Content-Type: application/json
Authorization: Bearer <token>   # 如果配置了 token
```

```json
{
  "model": "your-model-id",
  "prompt": "english danbooru tags",
  "orientation": "portrait",
  "width": 864,
  "height": 1536
}
```

`model` 来自角色卡的 `image.cards`，由 provider 自行解释。

## 响应

任选一种：

```json
{ "image_base64": "iVBORw0KGgo..." }
```

```json
{ "image_url": "https://example.com/image.png" }
```

或直接返回 `Content-Type: image/*` 的图片字节。

## 最小示例

```js
import http from 'node:http';

http.createServer(async (req, res) => {
  if (req.method !== 'POST') return res.writeHead(405).end();
  let body = '';
  for await (const chunk of req) body += chunk;
  const { prompt, width, height } = JSON.parse(body);

  // 在这里调用你自己的模型/绘图程序。
  const png = await generateYourImage(prompt, width, height);

  res.writeHead(200, { 'content-type': 'image/png' });
  res.end(png);
}).listen(9000, '127.0.0.1');
```

## 安全

- 只监听 `127.0.0.1` 或内网；
- 不要把无鉴权的生图服务暴露到公网；
- provider 会收到角色卡里的画面提示词，不要在里面放隐私。
