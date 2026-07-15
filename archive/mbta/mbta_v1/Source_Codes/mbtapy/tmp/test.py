import sys
import urllib.request
import json

from shiny import *

def getData():
    url = "http://127.0.0.1:5000/proxy"
    if "pyodide" in sys.modules:
        import pyodide.http
        with pyodide.http.open_url(url) as f:
            as_json = json.loads(f.getvalue())
    else:
        response = urllib.request.urlopen(url)
        as_json = json.loads(response.read().decode("utf-8"))
    return as_json

app_ui = ui.page_fluid(
    ui.output_text("txt")
)

def server(input, output, session):
    @output
    @render.text
    def txt():
        as_json = getData()
        return as_json

app = App(app_ui, server)

# run_app(app)


