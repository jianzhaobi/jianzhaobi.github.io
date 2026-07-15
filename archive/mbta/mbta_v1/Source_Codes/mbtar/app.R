library(shiny)
library(bslib)
library(rjson)
library(dplyr)
library(leaflet)
library(leaflet.extras)
library(sf)
library(gtools)
library(htmlwidgets)

# ====================== # 
# ====================== # 
# ====================== # 

if (!file.exists('./data/all.RData')) {
  
  # Route shapefiles
  rapidshp <- st_read('./data/rapid/MBTA_ARC.shp') %>% 
    select(LINE, ROUTE) %>% 
    st_transform(crs = 4326)
  
  busshp <- st_read('./data/bus/MBTABUSROUTES_ARC.shp') %>% 
    rename(LINE = CTPS_ROUTE) %>% 
    mutate(ROUTE = NA) %>% 
    select(LINE, ROUTE) %>% 
    st_transform(crs = 4326) %>% 
    st_zm()
  
  routeshp <- rbind(rapidshp, busshp)
  
  # Vehicle Info
  direction <- read.csv(file = './data/directions.txt') %>% 
    rename(Route = route_id,
           Direction = direction_id,
           Bound = direction,
           Destination = direction_destination) %>% 
    mutate(Direction = as.numeric(Direction))
  
  trip <- read.csv(file = './data/trips.txt') %>% 
    rename(Trip = trip_id,
           Headsign = trip_headsign) %>% 
    select(Trip, Headsign)
  
  stop <- read.csv(file = './data/stops.txt') %>% 
    rename(Stop = stop_id,
           Stopname = stop_name) %>% 
    select(Stop, Stopname)
  
  save(routeshp, direction, trip, stop, file = './data/all.RData')
  
} else {
  
  load('./data/all.RData')
  
}

# Refresh function
getMBTA <- function(route) {
  
  # JSON
  jdat <- fromJSON(readLines('https://cdn.mbta.com/realtime/VehiclePositions_enhanced.json', warn = F))
  
  # == Process JSON Data == #
  
  # Vehicles
  jdf <- tibble()
  for (i in 1 : length(jdat$entity)) {
    
    car <- jdat$entity[[i]]
    jdf <- rbind(jdf, 
                 tibble(
                   ID = ifelse(!is.null(car$id), car$id, NA),
                   Lat = ifelse(!is.null(car$vehicle$position$latitude), car$vehicle$position$latitude, NA),
                   Lon = ifelse(!is.null(car$vehicle$position$longitude), car$vehicle$position$longitude, NA),
                   Route = ifelse(!is.null(car$vehicle$trip$route_id), car$vehicle$trip$route_id, NA),
                   Direction = ifelse(!is.null(car$vehicle$trip$direction_id), car$vehicle$trip$direction_id, NA),
                   Carriage = ifelse(!is.null(length(car$vehicle$multi_carriage_details)), length(car$vehicle$multi_carriage_details), NA),
                   Trip = ifelse(!is.null(car$vehicle$trip$trip_id), car$vehicle$trip$trip_id, NA),
                   Stop = ifelse(!is.null(car$vehicle$stop_id), car$vehicle$stop_id, NA),
                   Status = ifelse(!is.null(car$vehicle$current_status), car$vehicle$current_status, NA)
                 ))
    
  }
  
  # Direction
  jdf <- merge(jdf, direction, by = c('Route', 'Direction'), all.x = T, all.y = F)
  jdf <- merge(jdf, trip, by = c('Trip'), all.x = T, all.y = F)
  jdf <- merge(jdf, stop, by = c('Stop'), all.x = T, all.y = F)
  
  # Headsign
  jdf$Headsign[is.na(jdf$Headsign)] <- jdf$Destination[is.na(jdf$Headsign)]
  
  # == Route Selection == #
  
  # Route
  rdf <- jdf %>% 
    filter(Route == route) %>% 
    st_as_sf(coords = c('Lon', 'Lat'), crs = 4326) 
  
  # Route shp
  sdf <- routeshp %>% 
    filter(LINE == toupper(gsub('\\-.*', '', route)))
  
  # bound
  bounds <- rdf %>% 
    st_bbox() %>% 
    as.character()
  
  return(list(jdat = jdat, jdf = jdf, rdf = rdf, sdf = sdf, bounds = bounds))
  
}

# ====================== # 
# ====================== # 
# ====================== # 

ui <- fluidPage(
  
  titlePanel(h3('MBTA Real-Time Map')),
  h5('By Jianzhao Bi'),
  selectInput(
    inputId = 'route',
    label = NULL,
    choices = c('Green-B', 'Green-C', 'Green-D', 'Green-E', 'Red', 'Orange', 'Blue',
                '1', '57', '60', '64', '66', '70', '86', '88', '90'),
    selected = 'Green-B',
    selectize = F
  ),
  verbatimTextOutput(outputId = 'time'),
  p(),
  p(),
  leafletOutput(
    outputId = 'routemap',
    height = '60vh'
  )
  
)

server <- function(input, output, session) {
  
  # --- Initial --- #
  
  # Base Map
  output$routemap <- renderLeaflet({
    
    # Map
    initmap <- leaflet(options = leafletOptions(zoomControl = F, attributionControl = F)) %>%
      # --- #
      addTiles(
        urlTemplate = "https://tile.thunderforest.com/transport/{z}/{x}/{y}.png?apikey=74002972fcb44035b775167d6c01a6f0",
        options = tileOptions(variant='transport', apikey = '74002972fcb44035b775167d6c01a6f0')
      ) %>%
      # --- #
      # Zoom +- button
      onRender(
        "function(el, x) {
          L.control.zoom({position:'bottomright'}).addTo(this);
        }") %>% 
      # Set view
      setView(lng = -71.0889, lat = 42.3601, zoom = 12)
    #   addControlGPS(options = gpsOptions(position = 'topleft',
    #                                      activate = T,
    #                                      autoCenter = T,
    #                                      maxZoom = 14,
    #                                      setView = T))
    # 
    # activateGPS(initmap)
    
  })
  
  # --- Data --- #
  refreshMBTA <- function(ifupdate = T, ifsetview = F) {
    
    # Update Data
    if (ifupdate) {
      mbta.lst <<- getMBTA(route = input$route)
      # mbta.color <- gsub('\\-.*', '', input$route)
      # if (!is.na(as.numeric(mbta.color))) mbta.color <- '#FFD800'
    }
    
    
    # Update Time
    output$time <- renderPrint({
      t <- as.POSIXlt(as.numeric(mbta.lst$jdat$header$timestamp), origin = '1970-01-01', tz = 'America/New_York')
      cat(input$route, as.character(t, usetz = T))
    })
    
    # Update Map
    if (nrow(mbta.lst$rdf) > 0) {
      
      maprefresh <- leafletProxy(data = mbta.lst$rdf,
                                 mapId = 'routemap',
                                 session = session) %>%
        clearMarkers() %>%
        addCircleMarkers(data = mbta.lst$rdf,
                         label = sprintf('ID: %s<br/>Cars: %s<br/>[%s] To %s<br/> %s %s',
                                         mbta.lst$rdf$ID, mbta.lst$rdf$Carriage,
                                         mbta.lst$rdf$Bound, mbta.lst$rdf$Headsign,
                                         mbta.lst$rdf$Status, mbta.lst$rdf$Stopname) %>%
                           lapply(htmltools::HTML),
                         color = ~ ifelse(Direction == 1, 'blue', 'green'),
                         stroke = T, opacity = 0.5, fillOpacity = 0.2)
      if (ifsetview) {
        maprefresh <- maprefresh %>% 
          clearShapes() %>%
          addPolylines(data = mbta.lst$sdf, color = 'orange', opacity = 0.4) %>%
          fitBounds(mbta.lst$bounds[1], 
                    mbta.lst$bounds[2],
                    mbta.lst$bounds[3], 
                    mbta.lst$bounds[4])
      }
      
      maprefresh
      
    }
  }
  
  
  # --- Refresh --- #
  # Update when change route
  observeEvent(input$route, {
    refreshMBTA(ifupdate = T, ifsetview = T)
  })
  # Automatic updates
  observe({
    invalidateLater(5000, session)
    refreshMBTA(ifupdate = T, ifsetview = F)
  })
  
}

shinyApp(ui, server)
