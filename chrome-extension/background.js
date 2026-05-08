// Background script for handling extension clicks
chrome.action.onClicked.addListener((tab) => {
  // Open the Codeforces tool page when extension icon is clicked
  chrome.tabs.create({
    url: chrome.runtime.getURL('pages/codeforces.html')
  });
});
