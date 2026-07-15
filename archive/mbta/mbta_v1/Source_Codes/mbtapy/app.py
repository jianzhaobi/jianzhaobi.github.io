from io import StringIO

import pandas as pd
import geopandas as gpd
import json
import urllib
import sys

import ipyleaflet as ipyl
import ipywidgets as widgets

from shiny import *
from shinywidgets import *
from datetime import datetime

# Route Data
# https://mbta-massdot.opendata.arcgis.com/maps/MassDOT::mbta-systemwide-gtfs-map/about

# Shinylive
# shinylive export mbtapy site
# python3 -m http.server --directory site --bind localhost 8008

def getMBTA(route, route_shp):
    # MBTA JSON file
    # https://shinylive.io/py/examples/#fetch-data-from-a-web-api
    url = "https://mbta-flask-513a6449725e.herokuapp.com/proxy"
    if "pyodide" in sys.modules:
        import pyodide.http
        with pyodide.http.open_url(url) as f:
            jdat = json.loads(f.getvalue())
    else:
        response = urllib.request.urlopen(url)
        jdat = json.loads(response.read().decode("utf-8"))

    jdat_header = jdat["header"]
    jdat_entity = jdat["entity"]

    # MBTA DataFrame
    jdf = pd.DataFrame({})
    for i in range(len(jdat_entity)):
        # Vehicle
        car = jdat_entity[i]
        # DataFrame
        cdf = pd.DataFrame(
            {
                "ID": [car.get("id")],
                "Lat": [car.get("vehicle").get("position").get("latitude")],
                "Lon": [car.get("vehicle").get("position").get("longitude")],
                "Route": [car.get("vehicle").get("trip").get("route_id")],
                "Direction": [car.get("vehicle").get("trip").get("direction_id")],
                "Carriage": [
                    (
                        len(car.get("vehicle").get("multi_carriage_details"))
                        if car.get("vehicle").get("multi_carriage_details") != None
                        else "-"
                    )
                ],
                "Leadcar": [
                    (
                        car.get("vehicle").get("multi_carriage_details")[0].get('label')
                        if car.get("vehicle").get("multi_carriage_details") != None
                        else "-"
                    )
                ],
                "Trip": [car.get("vehicle").get("trip").get("trip_id")],
                "Stop": [car.get("vehicle").get("stop_id")],
                "Status": [car.get("vehicle").get("current_status")],
            }
        )
        # Combine
        jdf = pd.concat([jdf, cdf], ignore_index=True)

    # Route
    rdf = jdf[jdf["Route"] == route]
    sdf = route_shp[route_shp["route_id"] == route]
    sdf = sdf[['OBJECTID', 'geometry']]

    return rdf, sdf, jdat_header, jdat_entity

# ------------------- #

# Define UI
app_ui = ui.page_fluid(
    ui.panel_title("MBTA Real-Time Map"),
    ui.tags.h5("By Jianzhao Bi"),
    ui.input_select(id="route", label=None, choices=[
        'Green-B', 'Green-C', 'Green-D', 'Green-E', 'Red', 'Orange', 'Blue',
        '1', '57', '60', '64', '66', '70', '86', '88', '90'
    ], selected="Green-E"),
    ui.output_text("nowtime"),
    output_widget("routemap"),
)

def server(input, output, session):

    # Register data and map
    mbta_lst = reactive.value()
    route_map = ipyl.Map(
                basemap=ipyl.TileLayer(url='https://tile.thunderforest.com/transport/{z}/{x}/{y}.png?apikey=74002972fcb44035b775167d6c01a6f0'),
                center=(42.3601, -71.0889),  # (lat, lon)
                zoom=12,
                close_popup_on_click=False,
                scroll_wheel_zoom=True,
                touch_zoom=True,
                zoom_control=False,
                zoom_snap=0.5, # Forces the map’s zoom level to always be a multiple of this.
                zoom_delta=1, # Controls how much the map’s zoom level will change after pressing + or - on the keyboard, or using the zoom controls.
                box_zoom=False, # Whether the map can be zoomed to a rectangular area specified by dragging the mouse while pressing the shift key
            )
    route_map.add(ipyl.ZoomControl(position="bottomright"))
    route_map.layout.height = "550px"
    register_widget("routemap", route_map)

    # Route GeoJSON files
    # bus_url = "https://jianzhaobi.github.io/data/Bus_Routes.geojson"
    # if "pyodide" in sys.modules:
    #     import pyodide.http
    #     with pyodide.http.open_url(bus_url) as f:
    #         bus_dat = f.getvalue()
    # else:
    #     response = urllib.request.urlopen(bus_url)
    #     bus_dat = response.read().decode("utf-8")
    # bus_route = gpd.read_file(bus_dat)
    # transit_url = "https://jianzhaobi.github.io/data/Transit_Routes.geojson"
    # if "pyodide" in sys.modules:
    #     import pyodide.http
    #     with pyodide.http.open_url(transit_url) as f:
    #         transit_dat = f.getvalue()
    # else:
    #     response = urllib.request.urlopen(transit_url)
    #     transit_dat = response.read().decode("utf-8")
    # transit_route = gpd.read_file(transit_dat)
    # route_shp = pd.concat([bus_route, transit_route])
    route_url = "https://jianzhaobi.github.io/data/routes.geojson"
    if "pyodide" in sys.modules:
        import pyodide.http
        with pyodide.http.open_url(route_url) as f:
            route_dat = f.getvalue()
            route_shp = gpd.read_file(route_dat)
    else:
        # response = urllib.request.urlopen(route_url)
        # route_dat = response.read().decode("utf-8")
        route_url = "data/outputs/routes.geojson"
        route_shp = gpd.read_file(route_url)

    # Direction
    dirct_url = "https://jianzhaobi.github.io/data/directions.txt"
    if "pyodide" in sys.modules:
        import pyodide.http
        with pyodide.http.open_url(dirct_url) as f:
            dirct_dat = f.getvalue()
            dirct_df = pd.read_csv(StringIO(dirct_dat))
    else:
        dirct_url = "data/outputs/directions.txt"
        dirct_df = pd.read_csv(dirct_url)
    dirct_df = dirct_df.rename(columns={
        'route_id': 'Route',
        'direction_id': 'Direction',
        'direction': 'Bound',
        'direction_destination': 'Destination'
    })

    # Trip
    trip_url = "https://jianzhaobi.github.io/data/trip_compressed.txt"
    if "pyodide" in sys.modules:
        import pyodide.http
        with pyodide.http.open_url(trip_url) as f:
            trip_dat = f.getvalue()
            trip_df = pd.read_csv(StringIO(trip_dat))
    else:
        trip_url = "data/outputs/trip_compressed.txt"
        trip_df = pd.read_csv(trip_url)

    # Update automatically
    @reactive.Effect
    def _():
        # MBTA real-time
        mbta_lst.set(getMBTA(input.route(), route_shp))
        mbta_df, mbta_shp, mbta_h, mbta_e = mbta_lst.get()
        # Direction
        mbta_df = mbta_df.merge(dirct_df, on=['Route', 'Direction'], how='left')
        mbta_df = mbta_df.merge(trip_df, on=['Trip'], how='left')
        mbta_df.loc[mbta_df['Headsign'].isna(), 'Headsign'] = mbta_df.loc[mbta_df['Headsign'].isna(), 'Destination']
        # Clear markers
        route_map.layers = [layer for layer in route_map.layers if isinstance(layer, ipyl.TileLayer)]  # clear layers
        # Route
        geodata = ipyl.GeoData(geo_dataframe=mbta_shp,
                               style={'color': 'orange', 'fillColor': 'orange', 'opacity': 0.2, 'weight': 4,
                                      'dashArray': '2', 'fillOpacity': 0.2})
        route_map.add(geodata)
        if len(mbta_df) != 0:
            for i in range(len(mbta_df)):
                # Trains
                marker = ipyl.CircleMarker(
                    location=(mbta_df["Lat"].iloc[i], mbta_df["Lon"].iloc[i]),
                    radius=10,
                    color="blue" if mbta_df["Direction"].iloc[i] == 1 else "green",
                    opacity=0.5,
                    draggable=False,
                )
                items = [widgets.Button(description=f"{mbta_df['ID'].iloc[i]}", disabled=True),
                         widgets.Button(description=f"Cars: {mbta_df['Carriage'].iloc[i]} ({mbta_df['Leadcar'].iloc[i]})", disabled=True),
                         widgets.Button(description=f"To {mbta_df['Headsign'].iloc[i]}", disabled=True, layout=widgets.Layout(width='auto')),
                         widgets.Button(description=f"{mbta_df['Status'].iloc[i]}", disabled=True, layout=widgets.Layout(width='auto'))]
                marker.popup = widgets.VBox(items)
                route_map.add(marker)
        reactive.invalidate_later(5)

    @reactive.Effect
    @reactive.event(input.route)
    def _():
        mbta_lst.set(getMBTA(input.route(), route_shp))
        mbta_df, mbta_shp, mbta_h, mbta_e = mbta_lst.get()
        if len(mbta_df) != 0:
            latmean = mbta_df["Lat"].mean()
            lonmean = mbta_df["Lon"].mean()
            route_map.center = (latmean, lonmean)
            route_map.zoom = 12

    @output
    @render.text
    def nowtime():
        mbta_df, mbta_shp, mbta_h, mbta_e = mbta_lst.get()
        if len(mbta_df) != 0:
            txt = str(input.route()) + " " + str(datetime.fromtimestamp(mbta_h["timestamp"]))
        else:
            txt = f"{input.route()} is not operating"
        return txt

app = App(app_ui, server)

# run_app(app)