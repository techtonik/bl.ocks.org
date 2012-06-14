#!/usr/bin/env python
#
# Copyright 2007 Google Inc.
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
#

import os
import wsgiref.handlers
import json
import re
from datetime import datetime
from cgi import escape
from urllib import quote
from markdown import markdown
from google.appengine.ext import webapp
from google.appengine.api.urlfetch import fetch

class GistRedirectHandler(webapp.RequestHandler):
  def get(self, id):
    self.redirect('/%s' % id)

class GistViewHandler(webapp.RequestHandler):
  def get(self, id):
    raw = fetch('https://api.github.com/gists/%s' % id, deadline=60)
    gist = json.loads(raw.content)
    owner = 'user' in gist and gist['user']['login'] or "anonymous"
    description = 'description' in gist and gist['description'] or id
    files = 'files' in gist and gist['files'] or []
    time = 'created_at' in gist and datetime.strptime(gist['created_at'], "%Y-%m-%dT%H:%M:%SZ") or None

    self.response.out.write(u"""
<!DOCTYPE html>
<meta charset="utf-8">
<title>%s</title>
<style>

@import url("/style.css?20120614");

</style>
<header>
  <a href="/%s">%s</a>\u2019s block <a href="https://gist.github.com/%s">#%s</a>
</header>
<h1>%s</h1>
<p><aside style="margin-top:-3.1em;">%s</aside><iframe marginwidth="0" marginheight="0" scrolling="no" src=\"/d/%s/\"></iframe>
<p><aside><a href="/d/%s/" target="_blank">Open in a new window.</a></aside>
""" % (escape(description), quote(owner), escape(owner), id, id, escape(description), time.strftime("%B %d, %Y"), id, id))

    # display the README
    for f in files:
      if re.match("^readme\.(md|mkd|markdown)$", f, re.I):
        html = "<p>%s</p>" % markdown(files[f]['content'])
      elif re.match("^readme(\.txt)?$", f, re.I):
        html = "<pre>%s</pre>" % escape(files[f]['content'])
      else:
        html = None
      if html:
        self.response.out.write(html)

    # display other files as source
    for f in files:
      if not re.match("^readme(\.[a-z]+)?$", f, re.I):
        self.response.out.write("""
<h2><a name="%s" href="#%s">#</a>%s</h2>
<pre><code class="%s">%s</code></pre>
""" % (quote(f), quote(f), f, os.path.splitext(f)[1][1:], escape(files[f]['content'])))

    self.response.out.write(u"""
<footer>
  <aside>%s</aside>
  <a href="https://github.com/%s">%s</a>\u2019s block <a href="https://gist.github.com/%s">#%s</a>
</footer>
<script src="/highlight.min.js"></script>
""" % (time.strftime("%B %d, %Y"), quote(owner), escape(owner), id, id))

class GistDataHandler(webapp.RequestHandler):
  def get(self, id, file):
    if not file:
      file = 'index.html'
    raw = fetch('https://raw.github.com/gist/%s/%s' % (id, quote(file)), deadline=30)
    if re.search("\.css$", file):
      self.response.headers["Content-Type"] = "text/css"
    elif re.search("\.js$", file):
      self.response.headers["Content-Type"] = "text/javascript"
    elif re.search("\.json$", file):
      self.response.headers["Access-Control-Allow-Origin"] = "*"
      self.response.headers["Content-Type"] = "application/json"
    elif re.search("\.txt$", file):
      self.response.headers["Content-Type"] = "text/plain"
    elif re.search("\.svg$", file):
      self.response.headers["Content-Type"] = "image/svg+xml"
    self.response.out.write(raw.content)

class GistUserHandler(webapp.RequestHandler):
  def get(self, owner):
    raw = fetch('https://api.github.com/users/%s/gists?per_page=100' % quote(owner), deadline=60)
    gists = json.loads(raw.content)
    self.response.out.write(u"""
<!DOCTYPE html>
<meta charset="utf-8">
<title>bl.ocks.org - %s</title>
<style>

@import url("/style.css?20120613");

h1 {
}

.block {
  border: solid 1px #ccc;
  box-sizing: border-box;
  display: inline-block;
  float: left;
  width: 230px;
  height: 80px;
  padding: 10px;
  margin: 0 10px 10px 0;
  position: relative;
}

.block:nth-child(4n+1) {
  margin-right: none;
}

.block:hover {
  background: #eee;
}

.date {
  color: #636363;
  display: block;
  font-size: smaller;
}

a.block:hover {
  text-decoration: none;
}

a.block:hover .description {
  text-decoration: underline;
}

</style>
<h1 style="margin-top:.8em;">%s\u2019s blocks</h1>
""" % (escape(owner), escape(owner)))

    for gist in gists:
      id = 'id' in gist and gist['id'] or "?"
      description = 'description' in gist and gist['description'] or id
      files = 'files' in gist and gist['files'] or []
      time = 'created_at' in gist and datetime.strptime(gist['created_at'], "%Y-%m-%dT%H:%M:%SZ") or None
      if "index.html" in files:
        self.response.out.write("""
<a class="block" href="/%s">
  <span class="description">%s</span>
  <span class="date">%s</span>
</a>
""" % (quote(id), escape(description), time.strftime("%B %d, %Y")))

    self.response.out.write("""
<br clear="both">
<footer>
  about <a href="/">bl.ocks.org</a>
</footer>
""")

def main():
  application = webapp.WSGIApplication([
      ('/([0-9]+)', GistViewHandler),
      ('/([0-9]+)/', GistRedirectHandler),
      ('/d/([0-9]+)/(.*)', GistDataHandler),
      (r'/(\w+)', GistUserHandler)
      ], debug=True)
  wsgiref.handlers.CGIHandler().run(application)

if __name__ == '__main__':
  main()
