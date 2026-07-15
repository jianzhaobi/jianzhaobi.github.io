from flask import Flask, request, jsonify, make_response
import requests

app = Flask(__name__)


@app.route('/proxy', methods=['GET'])
def proxy():
    url = 'https://cdn.mbta.com/realtime/VehiclePositions_enhanced.json'

    try:
        # Send a request to the target API
        response = requests.get(url)
        response.raise_for_status()  # Check if the request was successful
    except requests.exceptions.RequestException as e:
        return jsonify({"error": str(e)}), 500

    # Get the JSON data
    data = response.json()

    # Create a response object
    callback = request.args.get('callback')
    if callback:
        # If there is a callback parameter, return a JSONP response
        response = make_response(f"{callback}({jsonify(data).get_data(as_text=True)})")
        response.mimetype = 'application/javascript'
    else:
        # Otherwise, return a standard JSON response
        response = make_response(jsonify(data))

    # Add CORS headers
    response.headers['Access-Control-Allow-Origin'] = '*'
    # origin = request.headers.get('Origin')
    # allowed_origins = ['https://jianzhaobi.github.io', 'http://localhost', 'http://127.0.0.1']
    # if origin in allowed_origins:
    #     # Add CORS headers
    #     response.headers['Access-Control-Allow-Origin'] = origin

    return response


if __name__ == '__main__':
    app.run(debug=True, port=5000)