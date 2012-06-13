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
    raw = fetch('https://api.github.com/gists/%s' % id)
    meta = json.loads(raw.content)
    owner = 'user' in meta and meta['user']['login'] or "anonymous"
    description = 'description' in meta and meta['description'] or id
    files = 'files' in meta and meta['files'] or []
    time = 'created_at' in meta and datetime.strptime(meta['created_at'], "%Y-%m-%dT%H:%M:%SZ") or None

    self.response.out.write(u"""
<!DOCTYPE html>
<meta charset="utf-8">
<title>%s</title>
<style>

@import url("/style.css?20120614");

</style>
<header>
  <a href="https://github.com/%s">%s</a>\u2019s block <a href="https://gist.github.com/%s">#%s</a>
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
    raw = fetch('http://gist.github.com/raw/%s/%s' % (id, quote(file)))
    if re.search("\.css$", file):
      self.response.headers["Content-Type"] = "text/css"
    elif re.search("\.js$", file):
      self.response.headers["Content-Type"] = "text/javascript"
    elif re.search("\.json$", file):
      self.response.headers["Access-Control-Allow-Origin"] = "*"
      self.response.headers["Content-Type"] = "application/json"
    elif re.search("\.txt$", file):
      self.response.headers["Content-Type"] = "text/plain"
    self.response.out.write(raw.content)

def main():
  application = webapp.WSGIApplication([
      ('/([0-9]+)', GistViewHandler),
      ('/([0-9]+)/', GistRedirectHandler),
      ('/d/([0-9]+)/(.*)', GistDataHandler)
      ], debug=True)
  wsgiref.handlers.CGIHandler().run(application)

if __name__ == '__main__':
  main()
