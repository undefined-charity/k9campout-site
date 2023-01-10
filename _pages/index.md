---
layout: splash
author_profile: false
description: "Welcome to K9 Campout - a human pup and handler event at TRC"
permalink: /
header:
  image: /assets/images/k9campout_banner.jpg
---

K9 Campout is a human pup and handler event. The event is for LGBTQ+ persons, who enjoy human pups and those who love them. 2023 is the second year in a row for this event - and we look forward to seeing you all at TRC, Aug 4-6.

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