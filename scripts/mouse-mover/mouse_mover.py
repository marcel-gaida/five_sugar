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

# get the screen size
screen_width, screen_height = pyautogui.size()

# set the initial direction of the mouse movement
dx, dy = 1, 1
print ("Press CRTL+C to stop the mover from running.")
try:
    while True:
        # get the current mouse position
        x, y = pyautogui.position()

        # change the direction if the mouse cursor is at or beyond the screen border
        if x + dx > screen_width or x + dx < 0:
            dx *= -1
        if y + dy > screen_height or y + dy < 0:
            dy *= -1

        # move the mouse in the new direction
        pyautogui.moveTo(x + dx, y + dy, duration=0.4)
        time.sleep(0.4)
except KeyboardInterrupt:
    print("Exiting program")


