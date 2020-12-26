chrome.devtools.panels.create(
    "资源下载器",
    "128.png",
    "panel.html",
    function (panel) {
        console.log('dream_downloads panel create:', new Date().toLocaleString(), new Date().toJSON(), panel)
    }
)
