from PIL import Image, ImageDraw
import os

def create_icon(size, filename):
    # create a transparent image
    img = Image.new('RGBA', (size, size), (255, 255, 255, 0))
    draw = ImageDraw.Draw(img)
    
    # Calculate dimensions
    padding = size * 0.1
    center_x, center_y = size / 2, size / 2
    radius = (size / 2) - padding
    
    # Colors matching the theme
    primary_color = (15, 118, 110, 255)  # #0f766e
    accent_color = (42, 161, 152, 255)   # #2aa198
    hook_color = (249, 115, 22, 255)     # #f97316
    
    # Draw yarn ball (circle)
    draw.ellipse(
        [center_x - radius, center_y - radius, center_x + radius, center_y + radius],
        fill=primary_color
    )
    
    # Draw some "yarn" lines inside the ball
    line_width = max(1, int(size * 0.05))
    
    # Draw diagonal lines
    for i in range(3):
        offset = (i - 1) * radius * 0.5
        draw.line(
            [center_x - radius + abs(offset), center_y - offset, 
             center_x + radius - abs(offset), center_y + offset],
            fill=accent_color, width=line_width
        )
        draw.line(
            [center_x - offset, center_y - radius + abs(offset), 
             center_x + offset, center_y + radius - abs(offset)],
            fill=accent_color, width=line_width
        )

    # Draw crochet hook (a diagonal line from bottom-left to top-right across the yarn)
    hook_start = (padding, size - padding)
    hook_end = (size - padding, padding)
    draw.line([hook_start, hook_end], fill=hook_color, width=line_width * 2)
    
    # hook head
    draw.ellipse([size - padding - line_width*2, padding, size - padding, padding + line_width*2], fill=hook_color)

    img.save(filename)

os.makedirs("icons", exist_ok=True)
create_icon(16, "icons/icon16.png")
create_icon(48, "icons/icon48.png")
create_icon(128, "icons/icon128.png")
