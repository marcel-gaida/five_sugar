#!/usr/bin/env python
import os
import glob
import pandas as pd

# Get the current working directory (i.e., the directory where the script is located)
csv_dir = os.getcwd()

# Find all CSV files in the directory
csv_files = glob.glob(os.path.join(csv_dir, '*.csv'))

# Create an empty data frame to store the merged data
df_merged = pd.DataFrame()

# Iterate through the CSV files and read them into a data frame
for i, file in enumerate(csv_files):
    df = pd.read_csv(file, sep='\t', header=None, names=[f"m{i+1}"])
    #df = df.rename(columns={c: f"m{i+1}_{c}" for c in df.columns})
    df_merged = pd.concat([df_merged, df], axis=1)

# Write the merged data frame to an Excel file
df_merged.to_excel('merged.xlsx', index=False)