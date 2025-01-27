---
layout: splash
author_profile: false
description: "Welcome to K9 Campout - a human pup and handler event at TRC"
permalink: /
header:
  image: /assets/images/k9campout_banner.jpg
---

K9 Campout is a human pup and handler event. The event is for LGBTQ+ people, who enjoy human pups and those who love them. 2025 is the fourth year in a row for this event - and we look forward to seeing you all at TRC, Aug 15-17.


<h3 class="archive__subtitle">{{ site.data.ui-text[site.locale].recent_posts | default: "Recent Posts" }}</h3>

{% if paginator %}
  {% assign posts = paginator.posts %}
{% else %}
  {% assign posts = site.posts %}
{% endif %}

{% assign entries_layout = page.entries_layout | default: 'list' %}
<div class="entries-{{ entries_layout }}">
  {% for post in posts limit:3 %}
    {% include archive-single.html type=entries_layout %}
  {% endfor %}
</div>

{% include paginator.html %}