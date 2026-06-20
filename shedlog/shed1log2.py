import webbrowser
from threading import Timer
import os
import sys

# Ensure our local packages can be imported
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from app import app

def open_browser():
    webbrowser.open_new("http://127.0.0.1:5000")

if __name__ == '__main__':
    print("==================================================")
    print("🚀 ARTISTIC MILLINERS - SHED-01 FAULT LOGGER")
    print("==================================================")
    print("Starting Flask Web Server...")
    print("Launching the modern web interface in your browser...")
    print("--------------------------------------------------")
    
    # Open browser after 1.5 seconds once server starts up
    Timer(1.5, open_browser).start()
    
    # Run Flask server
    app.run(host='0.0.0.0', port=5000, debug=False)
