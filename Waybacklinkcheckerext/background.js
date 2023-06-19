chrome.runtime.onInstalled.addListener(function() {
    chrome.contextMenus.create({
      id: "checkWaybackMachine",
      title: "Check Wayback Machine",
      contexts: ["link"]
    });
    });
  chrome.contextMenus.onClicked.addListener(function(info, tab) {
    if (info.menuItemId === "checkWaybackMachine") {
      var url = "https://web.archive.org/web/*/" + info.linkUrl;
      chrome.tabs.create({ url: url });
    } 
  });
