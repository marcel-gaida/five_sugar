#!/usr/bin/env python
import subprocess

#Check if required libraries are installed
try:
    import requests
except ImportError:
    subprocess.run(["pip", "install", "requests"])
    import requests

try:
    from bs4 import BeautifulSoup
except ImportError:
    subprocess.run(["pip", "install", "BeautifulSoup4"])
    from bs4 import BeautifulSoup

try:
    import networkx as nx
except ImportError:
    subprocess.run(["pip", "install", "networkx"])
    import networkx as nx

from urllib.parse import urlparse

try:
    import plotly.graph_objs as go
except ImportError:
    subprocess.run(["pip", "install", "plotly"])
    import plotly.graph_objs as go

from plotly.offline import iplot, plot

url = input("Enter the URL: ")
headers = {
    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10.12; rv:55.0) Gecko/20100101 Firefox/55.0',
}
# Send a GET request to the website and get the HTML content
response = requests.get((url), headers=headers)
html_content = response.text

# Parse the HTML content using BeautifulSoup
soup = BeautifulSoup(html_content, "html.parser")

# Get all the links on the website
links = soup.find_all("a")

# Create an empty graph using networkx
graph = nx.Graph()

# Add nodes to the graph
for link in links:
    href = link.get("href")
    if href:
        # Parse the URL to get the domain
        domain = urlparse(href).netloc
        # Check if the domain is the same as the original domain
        is_original_domain = (domain == urlparse(url).netloc)
        # Add the node with the 'is_original_domain' attribute
        graph.add_node(href, is_original_domain=is_original_domain)

# Add edges to the graph
for node1 in graph.nodes():
    for node2 in graph.nodes():
        if node1 != node2 and node1 in node2:
            graph.add_edge(node1, node2)


# Convert the NetworkX graph to a Plotly figure
pos = nx.spring_layout(graph)
edge_x = []
edge_y = []
for edge in graph.edges():
    x0, y0 = pos[edge[0]]
    x1, y1 = pos[edge[1]]
    edge_x.extend([x0, x1, None])
    edge_y.extend([y0, y1, None])

edge_trace = go.Scatter(
    x=edge_x,
    y=edge_y,
    line=dict(width=0.5, color='#888'),
    hoverinfo='none',
    mode='lines')

# Create a trace for the nodes
node_x = []
node_y = []
node_text = []
node_color = []
for node in graph.nodes():
    x, y = pos[node]
    node_x.append(x)
    node_y.append(y)
    node_text.append('<a href="' + node + '" target="_blank">' + node + '</a>')
    node_color.append('blue' if graph.nodes[node]['is_original_domain'] else 'red')

#node_x = []
#node_y = []
#node_text = []
#for node in graph.nodes():
 #   x, y = pos[node]
  #  node_x.append(x)
   # node_y.append(y)
    #node_text.append(node)

#node_color = []
#for node, data in graph.nodes(data=True):
 #   if data['is_original_domain']:
  #      node_color.append('blue')
   # else:
    #    node_color.append('red')

node_trace = go.Scatter(
    x=node_x,
    y=node_y,
    text=node_text,
    textposition='top center',
    mode='markers',
    hoverinfo='text',
    marker=dict(
        color=node_color, # Set the color of the nodes
        size=10,
        line_width=2))

# Display the Plotly figure
fig = go.Figure(data=[edge_trace, node_trace],
                layout=go.Layout(
                    title=f'<br>Network graph for {url}',
                    titlefont_size=16,
                    showlegend=False,
                    hovermode='closest',
                    margin=dict(b=20,l=5,r=5,t=40),
                    annotations=[ dict(
                        text="Python code: <a href='https://plot.ly/ipython-notebooks/network-graphs/'> https://plot.ly/ipython-notebooks/network-graphs/</a>",
                        showarrow=False,
                        xref="paper", yref="paper",
                        x=0.005, y=-0.002 ) ],
                    xaxis=dict(showgrid=False, zeroline=False, showticklabels=False),
                    yaxis=dict(showgrid=False, zeroline=False, showticklabels=False))
                )
iplot(fig)


# Save the Plotly figure as an HTML file
plot(fig, filename='graph.html')

