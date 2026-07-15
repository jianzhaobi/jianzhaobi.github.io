# Archived MBTA Projects

This directory contains retired MBTA tracker implementations and their legacy static data:

- `mbta_v1/`: the original Shinylive/Python tracker
- `mbta_v1/Source_Codes/`: the original R, Python, Flask proxy, GTFS/GIS data, and exported Shinylive sources for v1
- `mbta_v2/`: the previous JavaScript tracker
- `data/`: static route, direction, and trip data used by the original tracker

The active tracker remains in `/mbta` and loads its runtime transit data from the MBTA v3 API.
