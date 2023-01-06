#!/usr/bin/env python
import subprocess
# Check if pyautogui is installed
try:
    import pyautogui
except ImportError:
    # If not, install pyautogui using subprocess
    subprocess.run(["pip", "install", "pyautogui"])
    # Reimport pyautogui
    import pyautogui

import time

#disable the failsafe
pyautogui.FAILSAFE = False

print ("Press CRTL+C to stop the mover from running.")
try:
    while True:
        # move the mouse to a random position
        x, y = pyautogui.position()
        pyautogui.moveTo(x + 10, y + 10, duration=0.5)
        time.sleep(0.5)
except KeyboardInterrupt:
    print("Exiting program")
