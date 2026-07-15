import urllib.request

print("------------------")

url = "https://api.openalex.org/works/W2741809807"
# url = "http://echo.jsontest.com/insert-key-here/insert-value-here/key/value"
response = urllib.request.urlopen(url)
print(response.info())

print("------------------")

# url = "https://cdn.mbta.com/realtime/VehiclePositions_enhanced.json"
url = "http://127.0.0.1:5000/proxy"
response = urllib.request.urlopen(url)
print(response.info())