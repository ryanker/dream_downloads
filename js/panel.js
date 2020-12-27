'use strict'

const isFirefox = navigator.userAgent.includes("Firefox")
const devtools = chrome.devtools

let itemsEl = document.getElementById('items')
let statEl = document.getElementById('statistics')
let resNumEl = document.getElementById('resourceNum')
let harNumEl = document.getElementById('harNum')
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
let uriArr = [] // 排重地址
let contents = {} // 记录所有资源内容 (数据比较大，访问过程中，直接保存在内存中，所以受内存大小限制)
let excluded = {} // 被排除的重复请求
let navUrl = '' // 当前访问链接
let urlArr = [] // 所有访问链接
let resObj = {} // 所有资源数据
let harObj = {} // 所有 HAR 日志
devtools.network.onNavigated.addListener(function (url) {
    navUrl = url
    urlArr.push(url)
})
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

    // 请求地址
    let url = request.url
    let method = request.method
    let uri = method + '-' + url

    // 根据 uri 排重后，保存文件内容到内存中
    getContent(r).then(data => {
        contents[uri] = {req: r, data}
    })

    // 根据请求地址排重
    let index = uriArr.indexOf(uri)
    if (index === -1) {
        uriArr.push(uri) // 记录请求地址
    } else {
        // 记录重复记录
        if (!excluded[uri]) excluded[uri] = 1
        excluded[uri]++

        // 清除重复记录，保留最后一次的资源 (替换后，索引位置不变)
        // requests.splice(index, 1, r)
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
        pathname = getZipName(url, mimeType)// 生成 zip 路径
        host = new URL(url).host
    }

    if (uriArr.length < 2) showTable() // 显示表格
    appendTable({status, method, host, pathname, url, mimeType, size}) // 追加表格
    statText() // 统计信息
    uniformWidth() // 统一宽度
    !isFirefox && resourceNum() // 统计资源数
    harLogNum() // 统计HAR日志数
}

// 下载资源
async function onDownload() {
    let log = '' // 正常日志
    let logErr = '' // 错误日志
    let logEncoding = '' // 有编码的文件日志

    // 添加 loading
    addLoading('正在打包...')
    setTimeout(rmLoading, 60 * 1000) // 超时时间

    // 遍历请求，获取资源并打包
    let zip = new JSZip()
    for (let k in contents) {
        // 初始变量
        let v = contents[k]
        let request = v.req.request
        let response = v.req.response
        let status = response.status
        let url = request.url
        let method = request.method
        let size = response.content.size
        let mimeType = (response.content.mimeType || '').trim()
        if (isFirefox) mimeType = mimeType.split(';')[0].trim()

        // 排除 data 和 bold 类型
        let pre = url.substring(0, 5)
        if (pre === 'data:' || pre === 'blob:') {
            if (pre === 'data:') url = url.substring(0, 19) + '...'
            logErr += `${status}\t${method}\t${humanSize(size)}\t${url}\n` // 记录文件内容为 data 和 blob 的日志
            continue
        }

        // 获取资源并打包
        let {content, encoding} = v.data
        /*if (!content && [200, 302].includes(status) && size > 0 && size < 1024 * 1024 * 10) {
            fetch(url).then(r => r.blob()).then(r => {
                content = r
            }).catch(err => {
                console.warn('fetch error:', err)
            })
        }*/
        if (!content) {
            logErr += `${status}\t${method}\t${humanSize(size)}\t${url}\n` // 记录文件内容为空的日志
            continue
        }

        // Firefox 抄 Chromium API 不一致，浪费不少时间，太折腾开发者了！设计这 API 的工程师脑子秀逗了？明显 Chromium API 更好用！
        // see https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/devtools.network/onRequestFinished
        if (isFirefox) encoding = response.content.encoding

        // 添加 zip 文件
        let zipName = getZipName(url, mimeType, method, true) // 生成 zip 路径
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
    }

    // 打包日志
    if (!isFirefox) {
        await getResources().then(resources => {
            zip.file('log.resources.json', JSON.stringify(resources, null, '\t')) // 全部资源 JSON
        }).catch(err => console.warn('getResources error:', err))
    }
    await getHAR().then(harLog => {
        zip.file('log.har.json', JSON.stringify(harLog, null, '\t')) // 全部HAR日志 JSON
    }).catch(err => console.warn('getResources error:', err))
    zip.file('log.txt', log) // 正常日志
    zip.file('log.err.txt', logErr) // 错误日志
    zip.file('log.encoding.txt', logEncoding) // 有编码的文件日志
    zip.file('log.contents.json', JSON.stringify(contents, null, '\t')) // 请求资源 JSON
    requestNum > uriArr.length && zip.file('log.repeat.json', JSON.stringify(excluded, null, '\t')) // 重复请求资源 JSON

    // 生成 zip 包，并下载文件
    await zip.generateAsync({type: "blob"}).then(function (blob) {
        // console.log('blob:', blob)
        let el = document.createElement('a')
        el.href = URL.createObjectURL(blob)
        el.download = `梦想网页资源下载器-${getDomain()}-${getDate()}.zip`
        el.click()
    }).catch(err => console.warn('zip generateAsync error:', err))

    rmLoading()  // 关闭 loading
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
    uriArr = [] // 排重地址
    contents = {} // 记录所有资源内容
    excluded = {} // 被排除的重复请求
    navUrl = '' // 当前访问链接
    urlArr = [] // 所有访问链接
    resObj = {} // 所有资源数据
    harObj = {} // 所有 HAR 日志
    statEl.innerText = ''
    resNumEl.innerText = ''
    harNumEl.innerText = ''
    itemsEl.innerText = ''
    closeDialog() // 关闭对话框

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
    let tr = addEl('tr', isErrorStatus(data.status) ? 'red' : '')
    tr.appendChild(addEl('td', 'tb_method', data.method))
    tr.appendChild(addEl('td', 'tb_host', data.host))
    tr.appendChild(addEl('td', 'tb_path', data.pathname, data.url))
    tr.appendChild(addEl('td', 'tb_type', data.mimeType))
    tr.appendChild(addEl('td', 'tb_size', humanSize(data.size)))
    tr.appendChild(addEl('td', 'tb_status', data.status))
    itemsEl.appendChild(tr)
}

// 统计信息
function statText() {
    statEl.innerText = ''
    statEl.appendChild(addEl('span', 'info', '总大小 ' + humanSize(totalSize)))
    statEl.appendChild(addEl('span', 'info', '总请求 ' + requestNum))
    statEl.appendChild(addEl('u', 'info', '重复请求 ' + (requestNum - uriArr.length), '', showExcludedDialog))
    statEl.appendChild(addEl('span', 'info', '实际请求 ' + uriArr.length))
}

// 统一宽度
function uniformWidth() {
    let bcr = table_body.querySelector('table').getBoundingClientRect()
    table_head.querySelector('th:last-child').style.width = (80 + (document.documentElement.scrollWidth - bcr.width)) + 'px'
}

// 统计资源数
function resourceNum() {
    if (window._rT) _clearTimeout(window._rT)
    window._rT = setTimeout(() => {
        getResources().then(r => {
            resObj[navUrl] = r // 按照请求链接，记录数据
            resNumEl.innerText = ''
            resNumEl.appendChild(addEl('u', 'info', '资源数 ' + r.length, '', () => showDialog(resObj, 'resources')))
        }).catch(err => console.warn('getResources error:', err))
    }, 500)
}

// 统计HAR日志数
function harLogNum() {
    if (window._hT) _clearTimeout(window._hT)
    window._hT = setTimeout(() => {
        getHAR().then(r => {
            harObj[navUrl] = r // 按照请求链接，记录数据
            harNumEl.innerText = ''
            harNumEl.appendChild(addEl('u', 'info', 'HAR日志数 ' + r.entries.length, '', () => showDialog(harObj, 'har')))
        }).catch(err => console.warn('getHAR error:', err))
    }, 500)
}

// 显示对话框 (资源数据和 HAR 日志)
function showDialog(obj, name) {
    let el = openDialog()
    let conEl = el.querySelector('.dialog_content')
    let titEl = el.querySelector('.dialog_title')
    let butEl = titEl.querySelector('.buts')
    let dowEl = addEl('span', 'icon icon-down', '', '下载JSON')
    let dow2El = addEl('span', 'icon icon-download')
    let curEl = addEl('u', 'show_current active', '当前')
    let allEl = addEl('u', 'show_all', '全部')
    let tabEl = addEl('div', 'tab flex_left')
    butEl.insertAdjacentElement('afterbegin', dowEl)
    butEl.insertAdjacentElement('afterbegin', dow2El)
    tabEl.appendChild(curEl)
    tabEl.appendChild(allEl)
    titEl.appendChild(tabEl)

    // 显示内容
    let textEl = addEl('textarea', 'code_text')
    conEl.appendChild(textEl)
    textEl.textContent = JSON.stringify(obj[navUrl], null, 2)

    // 下载JSON
    let showStatus = 'current'
    dowEl.addEventListener('click', () => {
        let b = showStatus === 'current' ? obj[navUrl] : obj
        downloadBlob(b, `${showStatus}_${name}`)
    })

    // 下载压缩包
    dow2El.addEventListener('click', () => {
        let b = showStatus === 'current' ? obj[navUrl] : obj
        downloadBlob(b, `${showStatus}_${name}`)
    })

    // 切换内容
    curEl.addEventListener('click', function () {
        showStatus = 'current'
        rmClass(allEl, 'active')
        addClass(curEl, 'active')
        textEl.textContent = JSON.stringify(obj[navUrl], null, 2)
    })
    allEl.addEventListener('click', function () {
        showStatus = 'all'
        rmClass(curEl, 'active')
        addClass(allEl, 'active')
        textEl.textContent = JSON.stringify(obj, null, 2)
    })
}

function showExcludedDialog() {
    let el = openDialog()
    let textEl = addEl('textarea', 'code_text')
    el.querySelector('.dialog_content').appendChild(textEl)
    textEl.textContent = JSON.stringify(excluded, null, 2)

    // 下载内容
    let dowEl = addEl('span', 'icon icon-down', '', '下载JSON')
    el.querySelector('.dialog_title .buts').insertAdjacentElement('afterbegin', dowEl)
    dowEl.addEventListener('click', () => downloadBlob(excluded, `excluded_repeat`))
}

function downloadBlob(s, name) {
    let el = document.createElement('a')
    let blob = new Blob([JSON.stringify(s, null, '\t')], {type: 'application/json'})
    el.href = URL.createObjectURL(blob)
    el.download = `梦想网页资源下载器-${getDomain()}-${getDate()}.${name}.json`
    el.click()
}

function openDialog() {
    closeDialog() // 只允许一个 dialog
    let el = addEl('div', 'dialog')
    let dt1 = addEl('div', 'dialog_title flex_left')
    let dt2 = addEl('div', 'buts')
    dt1.appendChild(dt2)
    dt2.appendChild(addEl('span', 'icon icon-close', '', '关闭', closeDialog))
    el.appendChild(dt1)
    el.appendChild(addEl('div', 'dialog_content'))
    document.body.appendChild(el)
    return el
}

function closeDialog() {
    $('.dialog').forEach(el => el.remove())
}

function $(s) {
    return document.querySelectorAll(s)
}

// 阻止 setTimeout 执行
function _clearTimeout(v) {
    clearTimeout(v)
    v = null
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
            // see https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/devtools.inspectedWindow
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
            // 已经无力吐槽了，官方文档 Examples 还是个错的。这接口和 Chromium 的一模一样嘛，不过数据比 chrome 多，包含文件数据。
            // see https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/devtools.network/getHAR
            // devtools.network.getHAR().then(harLog => resolve(harLog)).catch(err => reject(err))
            devtools.network.getHAR(harLog => resolve(harLog))
        } else {
            devtools.network.getHAR(harLog => resolve(harLog))
        }
    })
}

// 获取请求链接域名
function getDomain() {
    let u = new URL(navUrl)
    return u.host || u.protocol.replace(/\W/g, '') || 'unknown'
}

// 获取网页 Location
/*function getLocation() {
    return new Promise((resolve, reject) => {
        if (isFirefox) {
            // https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/devtools.inspectedWindow/eval
            browser.devtools.inspectedWindow.eval('location').then(r => r[0] ? resolve(r[0]) : reject(r[1]))
        } else {
            // todo: 此接口，估计 Manifest V3，会做调整
            // see https://developer.chrome.com/docs/extensions/reference/devtools_inspectedWindow/
            chrome.devtools.inspectedWindow.eval('location', (result, exceptionInfo) => {
                !exceptionInfo ? resolve(result) : reject(exceptionInfo)
            })
        }
    })
}*/

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
    d2.id = 'loadingText'
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
function addEl(tag, className, text, title, onClick) {
    let el = document.createElement(tag)
    if (className) el.className = className
    if (text) el.textContent = text
    if (title) el.title = title
    if (onClick) el.addEventListener('click', onClick)
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

function getZipName(url, mimeType, method, isFull) {
    if (url.includes('%')) url = decodeURIComponent(url) // 链接解码
    let u = {}
    try {
        u = new URL(url)
    } catch (e) {
    }
    let host = filterHan(u.host) || '-'
    let zipName = host + '/' + getDir(u.pathname) + getFixFilename(u.pathname, mimeType)
    if (isFull) {
        let protocol = u.protocol
        if (protocol === 'http:' || protocol === 'https:') protocol = ''
        else {
            protocol = protocol.replace(/[^\w\-]/, '')
            if (protocol) protocol = protocol + '/'
        }
        return (method ? method + '-' : '') + protocol + zipName
    }
    return zipName
}

// 修正最常见的类型即可，避免画蛇添足
function getFixFilename(s, contentType) {
    s = getFilename(s) || 'index'
    let ext = getExt(s)
    if (ext.length > 0) {
        return s // 有后缀就不做处理
    } else if (contentType.includes('text/html')) {
        return s + '.html'
    } else if (contentType.includes('text/css')) {
        return s + '.css'
    } else if (contentType.includes('json')) {
        return s + '.json'
    } else if (contentType.indexOf('text/') === 0) {
        return s + '.txt'
    } else if (contentType.includes('javascript')) {
        return s + '.js'
    } else if (contentType.includes('image/')) {
        if (contentType.includes('image/png')) return s + '.png'
        if (contentType.includes('image/jpeg')) return s + '.jpg'
        if (contentType.includes('image/gif')) return s + '.gif'
        if (contentType.includes('image/bmp')) return s + '.bmp'
        if (contentType.includes('image/x-icon')) return s + '.ico'
        return s + '.jpg' // 不是常见类型，随便补一个后缀
    } else {
        return s
    }
}

// 获取文件名
function getFilename(s) {
    if (!s) return ''

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
    s = filterHan(s)
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
    return s
}

// 获取目录
function getDir(s) {
    let n = s.lastIndexOf('/')
    if (n === -1 || !s) return ''
    s = s.substring(0, n) // 获取文件夹
    let arr = s.split('/')
    let r = []
    for (let i = arr.length - 1; i > -1; i--) {
        let name = filterHan(arr[i].trim())
        if (!name || name === '.') continue // 排除空目录
        if (name === '..') {
            r.pop()  // 退回一级目录
            continue
        }
        if (name.length > 64) name = s.substring(0, 64) // 限制文件名长度
        r.push(name)
    }
    if (r.length < 1) return ''
    r.reverse() // 倒序回来
    return r.join('/') + '/'
}

// 获取后缀
function getExt(s) {
    let n = s.lastIndexOf('.')
    if (n === -1) return '' // 没有后缀
    let ext = s.substring(n + 1)
    ext = ext.replace(/[^0-9a-zA-Z]/g, '') // 限制只能是数字和字母
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
        if (/[\w.@\-]/.test(v) || /\p{Unified_Ideograph}/u.test(v)) {
            r += v
        } else {
            r += '_'
        }
    }
    r = r.replace(/_{2,}/g, '_')
    return r
}
