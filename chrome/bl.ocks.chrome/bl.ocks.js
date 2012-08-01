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
  if ((location.hostname === "gist.github.com") && !(match && match[1])) match = href.match(reRel);
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

if (location.hostname === "gist.github.com") {
  var tr = document.createElement("tr"),
      id = location.pathname;
  tr.innerHTML = "<td class=label>Blocks URL:</td><td><a href='http://bl.ocks.org" + id + "'>http://bl.ocks.org" + id + "</a></td>";
  document.querySelector("#repos tbody").appendChild(tr);
}
