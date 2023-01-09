---
layout: splash
author_profile: false
permalink: /
feature_row:
  - image_path: /assets/images/k9campout.png
    alt: "K9 Campout"
    title: "<div class='logofont'>K9 Campout</div>"
---
{% include feature_row  type="center"%}

K9 Campout is a human pup and handler event. The event is for LGBTQ+ persons, who enjoy human pups and those who love them. The event will be hosted at CampTRC, WA, USA - Aug 4-6 2023.

![image-center](/assets/images/2023-flyer.jpg){: .align-center width="50%"}

<h3 class="archive__subtitle">{{ site.data.ui-text[site.locale].recent_posts | default: "Recent Posts" }}</h3>

{% if paginator %}
  {% assign posts = paginator.posts %}
{% else %}
  {% assign posts = site.posts %}
{% endif %}

{% assign entries_layout = page.entries_layout | default: 'list' %}
<div class="entries-{{ entries_layout }}">
  {% for post in posts %}
    {% include archive-single.html type=entries_layout %}
  {% endfor %}
</div>

{% include paginator.html %}