# Notebooks

This folder contains the exploratory, research, and analysis notebooks in `five_sugar`. It serves as the experimentation area of the repository for data work, workflow prototypes, and one-off investigations.

## Folder structure

The notebooks directory is organized by topic rather than by one shared pipeline.

```text
notebooks/
├── geocoding/
│   └── geocoding nominatim and uszipcode.ipynb
├── nlp/
│   ├── NLP for Reddit Posts.ipynb
│   ├── bertopic_intertopic_map.html
│   ├── bertopic_intertopic_map_tensorflow.html
│   └── bertopic_visualization.html
├── reddit/
│   ├── Reddit_Submission_Retriever.ipynb
│   └── clean spreadsheet.ipynb
├── web-scraping/
│   └── webscrapper with selenium for dynamic tables.ipynb
└── website-monitor.ipynb
```

## Notebook areas

### Geocoding

The `geocoding/` notebook focuses on location enrichment using Nominatim and `uszipcode`, for address lookup, normalization, or ZIP-code-based data augmentation.

### NLP

The `nlp/` folder centers on Reddit text analysis, with one notebook plus BERTopic visualization exports in HTML. The visualization files suggest exploratory topic modeling and interpretation alongside notebook-based analysis.

### Reddit

The `reddit/` folder holds data collection and cleanup workflows, including a submission retriever notebook and a spreadsheet-cleaning notebook.

### Web scraping

The `web-scraping/` notebook is oriented around Selenium and dynamic tables, suggesting browser-driven scraping for sites where plain HTTP requests are not enough.

### Website monitor

`website-monitor.ipynb` captures an availability or change-monitoring workflow. A Notebook-based prototype for monitoring and alerting.

## What to expect

Most notebooks here are exploratory or task-focused working files. Some notebooks are paired with generated artifacts such as HTML visualizations, so this folder contains both analysis code and outputs meant for browser review.
