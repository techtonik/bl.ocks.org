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
