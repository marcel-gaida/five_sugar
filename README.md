<h1 align="center">Welcome to five_sugar 👋</h1>
<p>
  <a href="https://github.com/marcel-gaida/five_sugar" target="_blank">
    <img alt="Documentation" src="https://img.shields.io/badge/documentation-yes-brightgreen.svg" />
  </a>
</p>


> Common issues - easy solution. This repository is a collection of different Python notebooks and scripts to be used as tools for common problems.
> These can range from simple data cleaning to web scraping, to little side projects for which I needed geocoding or zero-shot classification (ZSL/NLP).
> I also wrote a simple extension for Chrome to allow for lookups of linked content at the [webarchive.org](https://archive.org/web/) project. Simply install the extension [wayback machine link-checker](https://chrome.google.com/webstore/detail/wayback-machine-link-chec/cipnplfnagkmbejciolihbalkighckfe) from the Chrome Extension Store and add a right-click menu item to your browser that allows you to check if there are older versions of linked source available.  

## Author

👤 **Marcel Gaida**

* Github: [@marcel-gaida](https://github.com/marcel-gaida)
* LinkedIn: [@marcel-gaida](https://linkedin.com/in/marcel-gaida)
* Mastodon: [Fosstodon@mgaida](https://fosstodon.org/@mgaida)
* Fiverr: [@marcelga](https://www.fiverr.com/marcelga)
* Upwork: [@marcel.gaida](https://www.upwork.com/freelancers/~01f95c293d9fbe9529)

## Documentation

All notebooks and scripts have inline documentation to make it easier to reuse and rewrite the code when needed. 

## Usage

### For Reddit
The [for Reddit](https://github.com/marcel-gaida/five_sugar/tree/main/For%20Reddit) notebook allows retrieving submissions (posts) from a predefined subreddit using either [PRAW API](https://praw.readthedocs.io/en/stable/) or [Pushshift API](https://github.com/pushshift/api).  

### Geocoding
[The geocoding](https://github.com/marcel-gaida/five_sugar/tree/main/Geocoding) Jupyter notebook gives you the opportunity to get the geolocation of an address or zip code. The notebook uses [nominatim](https://nominatim.org/) and [uszipcode](https://pypi.org/project/uszipcode/) to retrieve longitude and latitude. Be aware that there is a limitation on how many requests can be sent at a given time. If you are trying to geocode bigger datasets this will take a significant amount of time.

### NLP
For the [topic visualization of r/dataisbeautiful](https://public.tableau.com/app/profile/marcel.gaida/viz/Topicsinrdataisbeautiful-topicmodellingexcerpt/About) I needed to analyze and categorize the posts in the subreddit. For this idea, I used BERTopic and ZeroShotClassification to go over the cleaned material and repeated the steps whenever necessary until I was satisfied with the outcome. The notebook also contains a tryout section where I tried to use Gensim to train an LDA model on the Reddit posts and visualize the topics at the end of the notebook.

### Wayback Machine Link-Checker Extension
To use the extension [wayback machine link-checker](https://chrome.google.com/webstore/detail/wayback-machine-link-chec/cipnplfnagkmbejciolihbalkighckfe) from the Chrome Extension Store. A right-click menu item is added to your browser allowing you to check if there are older versions of linked sources available at the [webarchive.org](https://archive.org/web/) project.

### Web Scraper - Selenium
The [Web Scraper](https://github.com/marcel-gaida/five_sugar/tree/main/Web%20Scraper) contains a Jupyter notebook that uses selenium to scrape a dynamic table on a given website. You will need the latest [chromedriver](https://chromedriver.chromium.org/) and define the path to the driver on your machine as well as the URL you want to scrape. You will also need to adjust the XPath and CSS selectors to fit the source from which you want to retrieve information.

### Others
The scripts in the main branch were basic exercises for a Python course I took. 
#### *CSV Merger* 
will merge CSV files that are in a directory the script is in. You can simply download the file and put it into a folder with the CSV files you want to merge. Be aware that it will label the content with  M+n* depending on the file it comes from.  

#### *Mouse Mover* 
will move your mouse on your screen in your absences. 

#### *Webmap* 
will ask you for a URL and then visualize the links on that page and color-code links leaving the original domain. 

#### *Check website availability and send a Pushbullet notification* 
Check if a website is available and send a Pushbullet notification. The script checks if a text is available on a website. If it finds the text it will retry again in 4 hours. If the text is not available it will send a Pushbullet notification. You will have to register a Pushbullet account as well as install the Pushbullet app on your phone. You can find the Pushbullet app in the app store. You can find the Pushbullet API documentation here: [https://docs.pushbullet.com/#api-overview](https://docs.pushbullet.com/#api-overview.)

## 🤝 Contributing

Any suggestions, issues, and feature requests are welcome!<br />Feel free to check [issues page](https://github.com/marcel-gaida/five_sugar/issues). 

Contributions are what make the open-source community such an amazing place to learn, inspire, and create. Any contributions you make are **greatly appreciated**.

Do you have a suggestion that would make this better? Please, fork the repo and create a pull request or simply open an issue with the tag "enhancement".
Don't forget to give the project a star!

1. Fork the Project
2. Create your Feature Branch (`git checkout -b feature/AmazingFeature`)
3. Commit your Changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the Branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

<p align="right">(<a href="#readme-top">back to top</a>)</p>

## Show your support

Give a ⭐️ if this project helped you!
You can also [buy me a coffee!](https://www.buymeacoffee.com/gaidamarcel)

## License
Distributed under the MIT License. See [LICENSE.txt](LICENSE.txt) for more information.

## Side Projects

Below you can find some side projects I have been working on. 

* [Wayback Machine Link-Checker](https://chrome.google.com/webstore/detail/wayback-machine-link-chec/cipnplfnagkmbejciolihbalkighckfe)
* [Topic Visualization r/dataisbeautiful](https://public.tableau.com/app/profile/marcel.gaida/viz/Topicsinrdataisbeautiful-topicmodellingexcerpt/About)
* [Visualization Gunviolence Archive.org](https://public.tableau.com/app/profile/marcel.gaida/viz/GunViolenceArchive-ExcerptofMassShootingsMay2020-May2023/About)

## Acknowledgments

Some of my favorite sites that help me get started or have helped me in the past. 

* [Jose Portilla's - The Complete Python Bootcamp From Zero to Hero in Python](https://www.udemy.com/course/complete-python-bootcamp/)
* [Pierian Data - Complete-Python-3-Bootcamp](https://github.com/Pierian-Data/Complete-Python-3-Bootcamp)
* [Font Awesome](https://fontawesome.com)
* [The Noun Project - Icons and Photos For Everything](https://thenounproject.com/)
* [Autodraw - help with Icons](https://www.autodraw.com/)

<p align="right">(<a href="#readme-top">back to top</a>)</p>



***

_This README's base outline was generated with ❤️ by [readme-md-generator](https://github.com/kefranabg/readme-md-generator)_
