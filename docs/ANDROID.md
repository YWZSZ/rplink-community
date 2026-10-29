# Android 构建

## Debug

```bash
cd android
./gradlew assembleDebug
```

APK：

```text
android/app/build/outputs/apk/debug/app-debug.apk
```

Debug 包使用 Android 默认 debug 签名，适合自己安装和分发给朋友，不适合上架商店。

## Release

在 `android/` 下创建 `keystore.properties`：

```properties
storeFile=your-release.jks
storePassword=...
keyAlias=...
keyPassword=...
```

并确保 `your-release.jks` 路径正确。然后：

```bash
./gradlew assembleRelease
```

`keystore.properties` 和 `*.jks` 已在 `.gitignore` 中，**不要提交**。

签名密钥一旦丢失，后续版本不能覆盖安装；请自行备份。

## 包名

通用版包名：

```text
com.rplink.community
```

如果你是二次分发者，建议改成自己的包名，避免和别人的安装包冲突。
