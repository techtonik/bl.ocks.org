window.addEventListener("load", function load() {
  window.removeEventListener("load", load, false);
  gBrowser.addEventListener("DOMContentLoaded", function(e) {
    var document = e.originalTarget,
        reGist = /^https?\:\/\/gist\.github\.com\/(\d*)/i,
        reRel = /^\/?(\d+)$/,
        gist = reGist.test(document.location.href),
        anchors = document.querySelectorAll("a[href]"),
        anchor,
        image,
        imageURL = "chrome://bl.ocks.org/content/bl.ocks.png",
        i = -1,
        n = anchors.length,
        href,
        match;
    while (++i < n) {
      match = (href = (anchor = anchors[i]).getAttribute("href")).match(reGist);
      if (gist && !(match && match[1])) match = href.match(reRel);
      if (match && match[1] && !anchor.matched) {
        anchor.matched = true; // avoid duplicate linking on iframes
        anchor = anchor.parentNode.insertBefore(document.createElement("a"), anchor.nextSibling);
        anchor.setAttribute("href", "http://bl.ocks.org/" + match[1]);
        anchor.setAttribute("title", "View bl.ock #" + match[1] + ".");
        anchor.style.marginLeft = "2px";
        image = anchor.appendChild(document.createElement("img"));
        image.setAttribute("src", imageURL);
        image.style.width = "16px";
      }
    }
  }, false);
}, false);
