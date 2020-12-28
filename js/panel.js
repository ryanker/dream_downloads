'use strict'

const isFirefox = navigator.userAgent.includes("Firefox")
const devtools = chrome.devtools

let itemsEl = document.getElementById('items')
let statEl = document.getElementById('statistics')
let resNumEl = document.getElementById('resourceNum')
let harNumEl = document.getElementById('harNum')
let pageNumEl = document.getElementById('pageNum')
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
let requests = {} // 所有资源请求
let contents = {} // 所有资源内容 (数据比较大，访问过程中，直接保存在内存中，所以受内存大小限制)
let excluded = {} // 被排除的重复请求
let navUrl = '' // 当前访问链接
let urlArr = [] // 所有访问链接
let resObj = {} // 所有资源数据
let harObj = {} // 所有 HAR 日志
devtools.network.onNavigated.addListener(onNavigated) // 访问新页面
devtools.network.onRequestFinished.addListener(onRequest) // 网络请求完成
downloadEl.addEventListener('click', onDownloadCache) // 下载资源 (从缓存数据中获取)
refreshEl.addEventListener('click', onRefresh) // 重新载入页面
switchBut.addEventListener('click', onSwitch) // 是否启用
clearBut.addEventListener('click', onClear) // 清空资源

// 访问新页面
function onNavigated(url) {
    navUrl = url
    urlArr.push(url)
    pageNumEl.innerText = ''
    pageNumEl.appendChild(addEl('u', 'info', '网页数 ' + urlArr.length, '访问的网页数量', () => {
        let el = openDialog()
        let textEl = addEl('textarea', 'code_text')
        el.querySelector('.dialog_content').appendChild(textEl)
        textEl.textContent = JSON.stringify(urlArr, null, 2)
    }))
}

// 网络请求完成
function onRequest(v) {
    if (switchBut.dataset.off === 'true') return // 停止资源获取
    requestNum++
    let request = v.request
    let response = v.response
    let status = response.status
    let content = response.content

    // 请求地址
    let url = request.url
    let method = request.method
    let uri = method + '-' + url

    // 根据 uri 排重后，保存文件内容到内存中
    requests[uri] = v
    getContent(v).then(data => {
        contents[uri] = data
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
    let size = content.size || response.bodySize || 0
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

// 下载资源 (从缓存中获取)
function onDownloadCache() {
    downloadByHar(Object.values(requests), '.requests', true).catch(_ => null)
}

// 下载资源 (从 HAR 日志中获取)
function onDownloadHar() {
    // 排重
    let allObj = {}
    for (let obj of Object.values(harObj)) {
        for (let v of obj.entries) {
            let url = v.request.method + '-' + v.request.url
            allObj[url] = v // 排重，只保留最后一条
        }
    }
    downloadByHar(Object.values(allObj), '.har').catch(_ => null)
}

// 通过 har 日志打包下载数据
async function downloadByHar(harArr, name, isCache) {
    addLoading('正在打包...') // 添加 loading
    setTimeout(rmLoading, 300 * 1000) // 超时时间

    let log = '' // 正常日志
    let logEmpty = '' // 空内容的文件日志
    let logExcluded = '' // 被排除的文件日志
    let logEncoding = '' // 有编码的文件日志

    // 遍历请求，获取资源并打包
    let zipPaths = {} // 记录 zip 包路径，允许重名
    let zip = new JSZip()
    for (let v of harArr) {
        let method = v.request.method
        let url = v.request.url
        let status = v.response.status
        let size = v.response.content.size || v.response.bodySize || 0
        let mimeType = v.response.content.mimeType
        if (isFirefox) mimeType = mimeType.split(';')[0].trim()

        // 排除 data 和 bold 类型 (由程序生成的数据)
        let pre = url.substring(0, 5)
        if (pre === 'data:' || pre === 'blob:') {
            logExcluded += `${url}\n` // 被排除的文件日志
            continue
        }

        let content = null, encoding = ''
        if (isCache) {
            let d = contents[`${method}-${url}`]
            if (d) {
                [content, encoding] = [d.content, d.encoding]
            }
            /*if (!content && [200, 302].includes(status) && size > 0 && size < 1024 * 1024 * 10) {
                fetch(url).then(r => r.blob()).then(r => {
                    content = r
                }).catch(err => {
                    console.warn('fetch error:', err)
                })
            }*/
        } else {
            await getContent(v).then(data => {
                [content, encoding] = [data.content, data.encoding]
                if (!content) {
                    // 尝试在缓存中，查收数据
                    let d = contents[`${method}-${url}`]
                    if (d) [content, encoding] = [d.content, d.encoding]
                }
            })
        }

        if (!content) {
            logEmpty += `${status}\t${method}\t${humanSize(size)}\t${url}\n` // 空内容的文件日志
            continue
        }

        let zipFile = getZipName(url, mimeType, method, true) // 生成 zip 路径
        if (!zipPaths[zipFile]) zipPaths[zipFile] = 1
        else {
            zipPaths[zipFile]++
            zipFile = renameZipName(zipFile, zipPaths[zipFile]) // 重名情况，重命名
        }

        // Firefox 抄 Chromium API 不一致，浪费不少时间，太折腾开发者了！设计这 API 的工程师脑子秀逗了？明显 Chromium API 更好用！
        // see https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/devtools.network/onRequestFinished
        if (isFirefox) encoding = v.response.content.encoding
        if (encoding) {
            logEncoding += `${status}\t${method}\t${encoding}\t${size}\t${url}\n` // 记录有编码的文件日志
            zip.file(zipFile, content, {base64: encoding === 'base64'}) // 目前浏览器只支持 base64 编码
        } else {
            zip.file(zipFile, content)
        }
        log += `${status}\t${method}\t${size}\t${url}\t${zipFile}\n` // 记录压缩正常日志
    }

    // 打包日志
    !isCache && zip.file('log.har.json', JSON.stringify(harObj, null, '\t')) // 所有 HAR 日志
    isCache && zip.file('log.requests.json', JSON.stringify(requests, null, '\t')) // 所有资源请求
    requestNum > uriArr.length && zip.file('log.repeat.json', JSON.stringify(excluded, null, '\t')) // 重复请求链接
    zip.file('log.txt', log) // 正常日志
    logEmpty && zip.file('log.empty.txt', logEmpty) // 空内容的文件日志
    logExcluded && zip.file('log.excluded.txt', logExcluded) // 被排除的文件日志
    logEncoding && zip.file('log.encoding.txt', logEncoding) // 有编码的文件日志

    // 生成 zip 包，并下载文件
    await zip.generateAsync({type: "blob"}).then(function (blob) {
        downloadZip(blob, name)
    }).catch(err => console.warn('zip generateAsync error:', err))

    rmLoading()  // 关闭 loading
}

// 下载资源 (从资源列表中获取) todo: Firefox 未实现此接口
async function onDownloadResources() {
    addLoading('正在打包...') // 添加 loading
    setTimeout(rmLoading, 300 * 1000) // 超时时间

    let log = '' // 正常日志
    let logEmpty = '' // 空内容的文件日志
    let logExcluded = '' // 被排除的文件日志
    let logEncoding = '' // 有编码的文件日志

    // 排重
    let allObj = {}
    for (let arr of Object.values(resObj)) {
        for (let v of arr) {
            let url = v.url
            // if (!allObj[url]) allObj[url] = v // 排重，只保留第一条
            allObj[url] = v // 排重，只保留最后一条
        }
    }

    // 遍历请求，获取资源并打包
    let zipPaths = {} // 记录 zip 包路径，允许重名
    let zip = new JSZip()
    for (let v of Object.values(allObj)) {
        let url = v.url
        let type = v.type

        // 排除 data 和 bold 类型 (由程序生成的数据)
        let pre = url.substring(0, 5)
        if (pre === 'data:' || pre === 'blob:') {
            logExcluded += `${url}\n` // 被排除的文件日志
            continue
        }

        await getContent(v).then(data => {
            let {content, encoding} = data
            if (!content) {
                // 尝试在缓存中，查收数据
                let d = contents[`GET-${url}`]
                if (d) [content, encoding] = [d.content, d.encoding]
            }
            if (!content) {
                logEmpty += `${type}\t${url}\n` // 空内容的文件日志
                return
            }

            // 添加 zip 文件
            let zipFile = getZipName(url, type, '', true) // 生成 zip 路径
            if (!zipPaths[zipFile]) zipPaths[zipFile] = 1
            else {
                zipPaths[zipFile]++
                zipFile = renameZipName(zipFile, zipPaths[zipFile]) // 重名情况，重命名
            }
            if (encoding) {
                logEncoding += `${encoding}\t${url}\n` // 记录有编码的文件日志
                zip.file(zipFile, content, {base64: encoding === 'base64'}) // 目前浏览器只支持 base64 编码
            } else {
                zip.file(zipFile, content)
            }
            log += `${type}\t${url}\t${zipFile}\n` // 记录压缩正常日志
        })
    }

    // 打包日志
    zip.file('log.resources.json', JSON.stringify(resObj, null, '\t')) // 所有资源数据
    zip.file('log.txt', log) // 正常日志
    logEmpty && zip.file('log.empty.txt', logEmpty) // 空内容的文件日志
    logExcluded && zip.file('log.excluded.txt', logExcluded) // 被排除的文件日志
    logEncoding && zip.file('log.encoding.txt', logEncoding) // 有编码的文件日志

    // 生成 zip 包，并下载文件
    await zip.generateAsync({type: "blob"}).then(function (blob) {
        downloadZip(blob, '.resources')
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
    requests = {} // 所有资源请求
    contents = {} // 所有资源内容
    excluded = {} // 被排除的重复请求
    navUrl = '' // 当前访问链接
    urlArr = [] // 所有访问链接
    resObj = {} // 所有资源数据
    harObj = {} // 所有 HAR 日志
    statEl.innerText = ''
    resNumEl.innerText = ''
    harNumEl.innerText = ''
    pageNumEl.innerText = ''
    itemsEl.innerText = '' // 清空表格
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
    let curEl = addEl('u', 'show_current active', '当前', '当前页面记录')
    let allEl = addEl('u', 'show_all', '全部', '全部页面记录')
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
        downloadJson(b, `${showStatus}_${name}`)
    })

    // 下载压缩包
    dow2El.title = name === 'resources' ? '下载资源 (从资源列表中获取)' : '下载资源 (从 HAR 日志中获取)'
    dow2El.addEventListener('click', () => {
        name === 'resources' ? onDownloadResources() : onDownloadHar()
    })

    // 切换内容
    let onActive = function (el) {
        tabEl.querySelectorAll('u').forEach(e => rmClass(e, 'active'))
        addClass(el, 'active')
    }
    curEl.addEventListener('click', function () {
        showStatus = 'current'
        onActive(curEl)
        textEl.textContent = JSON.stringify(obj[navUrl], null, 2)
    })
    allEl.addEventListener('click', function () {
        showStatus = 'all'
        onActive(allEl)
        textEl.textContent = JSON.stringify(obj, null, 2)
    })
}

// 显示重复请求对话框
function showExcludedDialog() {
    let el = openDialog()
    let textEl = addEl('textarea', 'code_text')
    el.querySelector('.dialog_content').appendChild(textEl)
    textEl.textContent = JSON.stringify(excluded, null, 2)

    // 下载内容
    let dowEl = addEl('span', 'icon icon-down', '', '下载JSON', () => downloadJson(excluded, `excluded_repeat`))
    el.querySelector('.dialog_title .buts').insertAdjacentElement('afterbegin', dowEl)
}

// 下载 JSON
function downloadJson(data, name) {
    let blob = new Blob([JSON.stringify(data, null, '\t')], {type: 'application/json'})
    let el = document.createElement('a')
    el.href = URL.createObjectURL(blob)
    el.download = `梦想网页资源下载器-${getDomain()}-${getDate()}.${name}.json`
    el.click()
}

// 下载 ZIP
function downloadZip(blob, name) {
    let el = document.createElement('a')
    el.href = URL.createObjectURL(blob)
    el.download = `梦想网页资源下载器-${getDomain()}-${getDate()}${name || ''}.zip`
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

// 修改 zip 路径（防止同名被覆盖，数字自增）
function renameZipName(zipFile, num) {
    let n = zipFile.lastIndexOf('/')
    let filename = n > -1 ? zipFile.substring(n + 1) : zipFile // 获取文件名

    n = filename.lastIndexOf('.')
    if (n === -1) return zipFile + '_' + num // 没有后缀就直接追加
    if (n === filename.length - 1) return zipFile + num // 特殊情况，直接追加
    let ext = filename.substring(n)
    let reg = new RegExp(ext.replace('.', '\\.') + '$')
    return zipFile.replace(reg, '_' + num + ext)
}

// 根据 URL 和文件类型生成 zip 路径
function getZipName(url, mimeType, method, isFull) {
    let u = {}
    try {
        u = new URL(url)
    } catch (e) {
    }
    let host = filterHan(u.host) || '-'
    let zipName = getDir(u.pathname) + getFixFilename(u.pathname, mimeType)
    if (isFull) {
        let protocol = ['http:', 'https:'].includes(u.protocol) ? '' : u.protocol.replace(/[^\w\-]/, '')
        if (method) method = method + '-'
        if (protocol) protocol = protocol + '/'
        if (host) host = host + '/'
        return method + protocol + host + zipName
    }
    return (host || '') + '/' + zipName
}

// 修正最常见的类型即可，避免画蛇添足
function getFixFilename(s, contentType) {
    s = getFilename(s) || 'index'
    let ext = getExt(s)
    if (ext.length > 0) {
        return s // 有后缀就不做处理
    } else if (contentType.includes('text/html') || contentType.includes('document')) {
        return s + '.html'
    } else if (contentType.includes('text/css') || contentType.includes('stylesheet')) {
        return s + '.css'
    } else if (contentType.includes('json')) {
        return s + '.json'
    } else if (contentType.indexOf('text/') === 0) {
        return s + '.txt'
    } else if (contentType.includes('javascript') || contentType.includes('sm-script')) {
        return s + '.js'
    } else if (contentType.includes('image')) {
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
        if (name.length > 64) name = s.substring(0, 64) // 限制目录名长度
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
    if (s.includes('%')) s = decodeURIComponent(s) // 链接解码
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
