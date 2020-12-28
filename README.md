# 梦想网页资源下载器 (Chrome & Firefox 扩展)
这是一款轻量级网页资源下载器，可打包下载全部网页资源（JS/CSS/HTML/Img/Media/Font等）。

是研究网站前端源码和一键下载网页资源之利器。

### 使用说明
此扩展程序在开发者控制台运行。

### 使用方法
1、打开 "开发者控制台"，快捷键 F12 或 ⌥⌘I；

2、点击 "资源下载器" 选项卡；

3、点击 "重新加载" 网页进行数据抓包；

4、点击 "下载资源" 保存全部网页资源；

### 日志说明 (ZIP 压缩包中的日志文件，建议看后删除，特别是带 cookie 的文件)
```text
log.txt // 打包成功的正常日志
log.empty.txt // 获取资源失败的链接日志
log.excluded.txt // 被排除的 data 和 blob 类型资源
log.encoding.txt // 被浏览器 base64 编码过的链接
log.resources.json // 浏览器获取的资源列表 （目前 Firefox 不支持这 API）
log.requests.json // 详细的浏览器请求记录，包含 cookie 和 一些服务器反馈信息
log.har.json // 详细的 HAR 日志记录，包含 cookie 和 一些服务器反馈信息
log.repeat.json // 重复请求的链接
```

### 统计打包文件数量是否正确
```shell script
# 统计当前目录下文件数（包括子目录）
$ ls -lR| grep "^-" | wc -l

# 统计当前目录下目录数（包括子目录）
$ ls -lR | grep "^d" | wc -l
```
