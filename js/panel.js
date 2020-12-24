'use strict'

const isFirefox = navigator.userAgent.includes("Firefox")
const devtools = chrome.devtools

let itemsEl = document.getElementById('items')
let statEl = document.getElementById('statistics')
let resEl = document.getElementById('resources')
let downloadEl = document.getElementById('download')
let refreshEl = document.getElementById('refresh')
let switchBut = document.getElementById('switchBut')
let clearBut = document.getElementById('clearBut')
let head_right = document.getElementById('head_right')
let table_head = document.getElementById('table_head')
let table_body = document.getElementById('table_body')
let table_empty = document.getElementById('table_empty')

let requestNum = 0 // 总请求数
let totalSize = 0 // 总文件大小
let uriArr = [] // 记录地址
let requests = [] // 记录请求
let excluded = {} // 被排除的重复请求

devtools.network.onRequestFinished.addListener(onRequest) // 网络请求完成
downloadEl.addEventListener('click', onDownload) // 下载资源
refreshEl.addEventListener('click', onRefresh) // 重新载入页面
switchBut.addEventListener('click', onSwitch) // 是否启用
clearBut.addEventListener('click', onClear) // 清空资源

// 网络请求完成
function onRequest(r) {
    if (switchBut.dataset.off === 'true') return // 停止资源获取
    requestNum++
    let request = r.request
    let response = r.response
    let status = response.status
    let content = response.content

    // 根据请求地址排重
    let url = request.url
    let method = request.method
    let uri = method + '-' + url
    let index = uriArr.indexOf(uri)
    if (index === -1) {
        uriArr.push(uri) // 记录请求地址
        requests.push(r) // 记录请求资源
    } else {
        // 记录重复记录
        if (!excluded[uri]) excluded[uri] = 1
        excluded[uri]++

        // 清除重复记录，保留最后一次的资源
        requests.splice(index, 1)
        requests.push(r) // 记录请求资源
        // itemsEl.querySelector(`tr:nth-of-type(${index + 1})`)?.remove()
        return
    }

    // 记录资源大小
    let size = content.size
    if (size > 0) totalSize += size

    // 文件类型
    let mimeType = (content.mimeType || '').trim()
    if (isFirefox) mimeType = mimeType.split(';')[0].trim()

    // 排除 data and blob URLs
    let pathname = ''
    let host = ''
    let pre = url.substring(0, 5)
    if (pre === 'data:') {
        pathname = url.substring(0, 19) + '...'
    } else if (pre === 'blob:') {
        pathname = url
    } else {
        // 生成 zip 路径
        let u = new URL(url)
        let dirname = getDir(u.pathname)
        let filename = getFixFilename(u.pathname, mimeType)
        pathname = dirname + filename
        host = u.host
    }

    if (requests.length < 2) showTable() // 显示表格
    appendTable({status, method, host, pathname, url, mimeType, size}) // 追加表格
    statHTML() // 统计信息
    uniformWidth() // 统一宽度
    !isFirefox && resourceNum() // 统计资源数
}

// 下载资源
async function onDownload() {
    let log = '' // 正常日志
    let logErr = '' // 错误日志
    let logEncoding = '' // 有编码的文件日志

    // 添加 loading
    addLoading('正在打包...')
    setTimeout(rmLoading, 30 * 1000) // 超时时间

    // 遍历请求，获取资源并打包
    let zip = new JSZip()
    for (const [k, v] of Object.entries(requests)) {
        // 初始变量
        let request = v.request
        let response = v.response
        let status = response.status
        let url = request.url
        let method = request.method
        let size = response.content.size
        let mimeType = (response.content.mimeType || '').trim()
        if (isFirefox) mimeType = mimeType.split(';')[0].trim()

        // 排除 data 和 bold 类型
        let pre = url.substring(0, 5)
        if (pre === 'data:' || pre === 'blob:') {
            logErr += `${status}\t${method}\t${humanSize(size)}\t${url.substring(0, 19)}...\n` // 记录文件内容为 data 和 blob 的日志
            continue
        }

        // 获取资源并打包
        await getContent(v).then(r => {
            let {content, encoding} = r
            if (!content) {
                logErr += `${status}\t${method}\t${humanSize(size)}\t${url}\n` // 记录文件内容为空的日志
                return
            }

            // 生成 zip 路径
            let u = new URL(url)
            let dirname = getDir(u.pathname)
            let filename = getFixFilename(u.pathname, mimeType)
            let zipName = method + '-' + u.host + dirname + filename

            // Firefox 抄 Chromium API 都抄的不一致，这是要折腾死开发者吗？设计者这 API 的工程师脑子秀逗了？明显 Chromium API 更好用，更明确！
            // see https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/devtools.network/onRequestFinished
            if (isFirefox) encoding = response.content.encoding
            if (encoding) {
                logEncoding += `${status}\t${method}\t${encoding}\t${size}\t${url}\n` // 记录有编码的文件日志
                zip.file(zipName, content, {base64: encoding === 'base64'}) // 目前浏览器只支持 base64 编码
            } else {
                zip.file(zipName, content)
            }
            log += `${status}\t${method}\t${size}\t${url}\t${zipName}\n` // 记录压缩正常日志

            // console.log('key:', k)
            // console.log('url:', url)
            // console.log('zip:', zipName)
        }).catch(err => console.warn('getContent error:', err))
    }

    // 打包日志
    zip.file('log.txt', log) // 正常日志
    zip.file('log.err.txt', logErr) // 错误日志
    zip.file('log.encoding.txt', logEncoding) // 有编码的文件日志
    zip.file('log.requests.json', JSON.stringify(requests, null, '\t')) // 请求资源 JSON
    requestNum > requests.length && zip.file('log.repeat.json', JSON.stringify(excluded, null, '\t')) // 重复请求资源 JSON
    if (!isFirefox) {
        await getResources().then(resources => {
            zip.file('log.resources.json', JSON.stringify(resources, null, '\t')) // 全部资源 JSON
        }).catch(err => console.warn('getResources error:', err))
    }
    await getHAR().then(harLog => {
        zip.file('log.har.json', JSON.stringify(harLog, null, '\t')) // 全部HAR日志 JSON
    }).catch(err => console.warn('getResources error:', err))

    // 生成 zip 包，并下载文件
    await zip.generateAsync({type: "blob"}).then(function (blob) {
        // console.log('blob:', blob)
        let el = document.createElement('a')
        el.href = window.URL.createObjectURL(blob)
        el.download = `梦想网页资源下载器-${getDate()}.zip`
        el.click()
    }).catch(err => console.warn('zip generateAsync error:', err))

    // 关闭 loading
    rmLoading()
}

// 重新载入页面
function onRefresh() {
    switchBut.dataset.off === 'true' && onSwitch() // 如果被关闭，那就开启
    devtools.inspectedWindow.reload()
}

// 是否启用
function onSwitch() {
    let el = switchBut
    let isOff = el.dataset.off === 'true'
    if (isOff) {
        addClass(el, 'active')
        el.title = '停止资源获取'
    } else {
        rmClass(el, 'active')
        el.title = '启用资源获取'
    }
    el.dataset.off = String(!isOff)
}

// 清空资源
function onClear() {
    requestNum = 0 // 总请求数
    totalSize = 0 // 总文件大小
    uriArr = [] // 记录地址
    requests = [] // 记录请求
    excluded = {} // 被排除的请求
    statEl.innerText = ''
    resEl.innerText = ''

    table_empty.style.display = 'flex'
    head_right.style.display = 'none'
    table_head.style.display = 'none'
    table_body.style.display = 'none'
}

// 显示表格
function showTable() {
    table_empty.style.display = 'none'
    head_right.style.display = 'flex'
    table_head.style.display = 'block'
    table_body.style.display = 'block'
}

// 表格数据
function appendTable(data) {
    let addTd = function (className, text, title) {
        let td = document.createElement('td')
        td.className = className
        td.textContent = text
        if (title) td.title = title
        return td
    }

    let tr = document.createElement('tr')
    if (isErrorStatus(data.status)) tr.className = 'red'
    tr.appendChild(addTd('tb_method', data.method))
    tr.appendChild(addTd('tb_host', data.host))
    tr.appendChild(addTd('tb_path', data.pathname, data.url))
    tr.appendChild(addTd('tb_type', data.mimeType))
    tr.appendChild(addTd('tb_size', humanSize(data.size)))
    tr.appendChild(addTd('tb_status', data.status))
    itemsEl.appendChild(tr)
}

// 统计信息
function statHTML() {
    statEl.innerText = ''
    let addEl = function (text) {
        let u = document.createElement('u')
        u.textContent = text
        return u
    }
    statEl.appendChild(addEl('总大小 ' + humanSize(totalSize)))
    statEl.appendChild(addEl('总请求 ' + requestNum))
    statEl.appendChild(addEl('重复请求 ' + (requestNum - uriArr.length)))
    statEl.appendChild(addEl('实际请求 ' + uriArr.length))
}

// 统一宽度
function uniformWidth() {
    let bcr = table_body.querySelector('table').getBoundingClientRect()
    table_head.querySelector('table').style.width = bcr.width + 'px'
}

// 统计资源数
function resourceNum() {
    getResources().then(resources => {
        resEl.textContent = '资源数 ' + resources.length
    }).catch(err => console.warn('getResources error:', err))
}

// 判断错误网络请求
function isErrorStatus(status) {
    return [0, 404].includes(Number(status))
}

// 获取资源内容
function getContent(request) {
    return new Promise((resolve, reject) => {
        try {
            request.getContent((content, encoding) => resolve({content, encoding}))
        } catch (err) {
            reject(err)
        }
    })
}

// 获取所有资源
function getResources() {
    return new Promise((resolve, reject) => {
        if (isFirefox) {
            reject('Firefox 未实现此接口')
            // devtools.inspectedWindow.getResources().then(resources => resolve(resources)).catch(err => reject(err))
        } else {
            devtools.inspectedWindow.getResources(resources => resolve(resources))
        }
    })
}

// 获取所有 HAR 日志
function getHAR() {
    return new Promise((resolve, reject) => {
        if (isFirefox) {
            devtools.network.getHAR().then(harLog => resolve(harLog)).catch(err => reject(err))
        } else {
            devtools.network.getHAR(harLog => resolve(harLog))
        }
    })
}

// 获取当前时间
function getDate() {
    let d = new Date()
    d.setMinutes(-d.getTimezoneOffset() + d.getMinutes(), d.getSeconds(), 0)
    let s = d.toISOString()
    s = s.replace('T', ' ')
    s = s.replace('.000Z', '')
    s = s.replace(/\D/g, '')
    return s
}

// 人类易读文件大小
function humanSize(n) {
    if (n < 1024) {
        return n + ' B'
    } else if (n < 1024 * 1024) {
        return (n / 1024).toFixed(2) + ' K'
    } else if (n < 1024 * 1024 * 1024) {
        return (n / 1024 / 1024).toFixed(2) + ' M'
    } else if (n < 1024 * 1024 * 1024 * 1024) {
        return (n / 1024 / 1024 / 1024).toFixed(2) + ' G'
    } else if (n < 1024 * 1024 * 1024 * 1024 * 1024) {
        return (n / 1024 / 1024 / 1024 / 1024).toFixed(2) + ' T'
    } else {
        return (n / 1024 / 1024 / 1024 / 1024 / 1024).toFixed(2) + ' P'
    }
}

// 添加 loading
function addLoading(text) {
    let d1 = addEl('div', 'load_img')
    let d2 = addEl('div', 'load_text', text)
    let d3 = addEl('div', 'loading_inner')
    let d4 = addEl('div', 'loading')
    d1.appendChild(addEl('i', 'icon icon-loading'))
    d3.appendChild(d1)
    d3.appendChild(d2)
    d4.appendChild(d3)
    document.body.appendChild(d4)
    document.body.appendChild(addEl('div', 'loading-bg'))
}

// 删除 loading
function rmLoading() {
    document.querySelectorAll('.loading-bg,.loading').forEach(el => el.remove())
}

// 添加 DOM 元素
function addEl(tag, className, text, title) {
    let el = document.createElement(tag)
    if (className) el.className = className
    if (text) el.textContent = text
    if (title) el.title = title
    return el
}

// 添加样式
function addClass(el, className) {
    className = className.trim()
    let oldClassName = el.className.trim()
    if (!oldClassName) {
        el.className = className
    } else if (` ${oldClassName} `.indexOf(` ${className} `) === -1) {
        el.className += ' ' + className
    }
}

// 删除样式
function rmClass(el, className) {
    if (!el.className) return
    className = className.trim()
    let newClassName = el.className.trim()
    if ((` ${newClassName} `).indexOf(` ${className} `) === -1) return
    newClassName = newClassName.replace(new RegExp('(?:^|\\s)' + className + '(?:\\s|$)', 'g'), ' ').trim()
    if (newClassName) {
        el.className = newClassName
    } else {
        el.removeAttribute('class')
    }
}

// 修正最常见的类型即可，避免画蛇添足
function getFixFilename(s, contentType) {
    s = getFilename(s) || 'index'
    let ext = getExt(s)
    if (contentType === 'text/html') {
        return ['htm', 'html'].includes(ext) ? s : s + '.html'
    } else if (contentType === 'text/css') {
        return ext === 'css' ? s : s + '.css'
    } else if (contentType === 'application/json') {
        return ext === 'json' ? s : s + '.json'
    } else if (contentType.includes('/javascript')) {
        return ext === 'js' ? s : s + '.js'
    } else if (contentType.includes('image/')) {
        if (s.includes('.')) return s // 只要有后缀就不管
        if (contentType === 'image/png') return s + '.png'
        if (contentType === 'image/gif') return s + '.gif'
        return s + '.jpg' // 不是常见类型，随便补一个后缀
    } else {
        return s
    }
}

// 获取文件名
function getFilename(s) {
    if (!s) return ''
    s = decodeURIComponent(s) // 链接解码

    // 过滤非法链接
    let n = s.indexOf(';')
    if (n > -1) {
        s = s.substring(0, n)
        if (!s) return ''
    }

    // 获取文件名
    n = s.lastIndexOf('/')
    if (n > -1) s = s.substring(n + 1)

    // 限制最大长度
    let maxLen = 64
    if (s.length > maxLen) {
        let ext = getExt(s)
        if (ext) {
            let name = s.substring(0, maxLen - ext.length - 1)
            s = name + '.' + ext // 缩短后的文件名
        } else {
            s = s.substring(0, maxLen)
        }
    }
    return filterHan(s)
}

// 获取目录
function getDir(s) {
    let n = s.lastIndexOf('/')
    return filterHan(n > -1 ? s.substring(0, n + 1) : '')
}

// 获取后缀
function getExt(s) {
    let n = s.lastIndexOf('.')
    if (n === -1) return '' // 没有后缀
    let ext = s.substring(n + 1)
    ext = ext.replace(/[^0-9a-zA-Z]/g, '') // 限制只能是数字，字母
    if (ext.length > 16) ext = ext.substring(0, 16) // 限制最大长度
    return ext.toLocaleLowerCase()
}

// 过滤字符串，防止压缩打包失败
// 参考：
// https://zhuanlan.zhihu.com/p/33335629
// https://keqingrong.github.io/blog/2020-01-29-regexp-unicode-property-escapes
// http://www.unicode.org/Public/10.0.0/ucd/PropList.txt Unified_Ideograph
function filterHan(s) {
    // console.log(/\p{Script=Han}/u.test('我是中国人，我爱中国'))
    // console.log(/^\p{Script=Han}+$/u.test('我是中国人，我爱中国'))
    // console.log(/\p{Unified_Ideograph}/u.test('我是中国人，我爱中国'))
    let r = ''
    for (let v of s) {
        if (/[\w./@\-]/.test(v) || /\p{Unified_Ideograph}/u.test(v)) {
            r += v
        } else {
            r += '_'
        }
    }
    return r
}
