if (location.hostname === "gist.github.com") {
  redraw();
  document.addEventListener("DOMSubtreeModified", redraw);

  function redraw() {
    var ul = document.querySelector(".export-references");
    if (!ul) return;
    var a = document.querySelector("#bl-ocks-org");
    if (!a) {
      var li = document.createElement("li");
      li.innerHTML = '<a class="minibutton" id="bl-ocks-org"><span class="mini-icon mini-icon-external-link"></span>bl.ocks.org</a>';
      a = li.firstChild;
      ul.insertBefore(li, ul.firstChild);
    }
    a.href = "http://bl.ocks.org" + location.pathname.replace(/\/revisions$/, "");
  }
} else {
  var reGist = /^https?\:\/\/gist\.github\.com\/([0-9]+(?:\/[0-9a-f]{40})?)$/,
      reRel = /^\/?([0-9]+(?:\/[0-9a-f]{40})?)$/,
      anchors = document.querySelectorAll("a[href]"),
      anchor,
      image,
      imageURL = chrome.extension.getURL("bl.ocks.png"),
      i = -1,
      n = (location.hostname !== "bl.ocks.org") && anchors.length,
      href,
      match;

  while (++i < n) {
    match = (href = (anchor = anchors[i]).getAttribute("href")).match(reGist);
    if (!(match && match[1])) match = href.match(reRel);
    if (match && match[1]) {
      anchor = anchor.appendChild(document.createElement("a"));
      anchor.setAttribute("href", "http://bl.ocks.org/" + match[1]);
      anchor.setAttribute("title", "View bl.ock #" + match[1] + ".");
      anchor.style.position = "relative";
      anchor.style.marginLeft = "2px";
      anchor.style.marginRight = "18px";
      image = anchor.appendChild(document.createElement("img"));
      image.setAttribute("src", imageURL);
      image.style.position = "absolute";
    }
  }
}
