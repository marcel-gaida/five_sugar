#!/usr/bin/env python
import subprocess

# Check if pandas is installed
try:
    import pandas as pd
except ImportError:
    # If not, install pandas using subprocess
    subprocess.run(["pip", "install", "pandas"])
    # Reimport pandas
    import pandas as pd

#Check if openpyxl is installed
try:
    import openpyxl
except ImportError:
    # If not, install pandas using subprocess
    subprocess.run(["pip", "install", "openpyxl"])
    # Reimport
    import openpyxl


# Run the rest of the script
import os
import glob


# Get the current working directory (i.e., the directory where the script is located)
csv_dir = os.getcwd()

# Find all CSV files in the directory
csv_files = glob.glob(os.path.join(csv_dir, '*.csv'))

# Create an empty data frame to store the merged data
df_merged = pd.DataFrame()

# Iterate through the CSV files and read them into a data frame
for i, file in enumerate(csv_files):
    df = pd.read_csv(file, sep='\t', header=None, names=[f"m{i+1}"])
    df_merged = pd.concat([df_merged, df], axis=1)

# Write the merged data frame to an Excel file
df_merged.to_excel('merged.xlsx', index=False)
