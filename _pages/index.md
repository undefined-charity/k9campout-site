---
layout: splash
author_profile: false
description: "Welcome to K9 Campout - a human pup and handler event at TRC"
permalink: /
header:
  image: /assets/images/k9campout_banner.jpg
---

K9 Campout is a human pup and handler event. The event is for LGBTQ+ people, who enjoy human pups and those who love them. 2025 is the fourth year in a row for this event - and we look forward to seeing you all at TRC, Aug 15-17.

<blockquote class="bluesky-embed" data-bluesky-uri="at://did:plc:fqgm57geg7cilwyz5keaxzdn/app.bsky.feed.post/3lgw45wt6bs2x" data-bluesky-cid="bafyreigvfr7zepojfrsboa7own6x3kbfxdzh6jkn766o3c64hv7vpu4sz4"><p lang="en">AAARRRROOOOOO!!!! 
Here’s a little teaser into last year’s K9 Campout. Are y’all ready to see the memories we captured?<br><br><a href="https://bsky.app/profile/did:plc:fqgm57geg7cilwyz5keaxzdn/post/3lgw45wt6bs2x?ref_src=embed">[image or embed]</a></p>&mdash; K9 Campout (<a href="https://bsky.app/profile/did:plc:fqgm57geg7cilwyz5keaxzdn?ref_src=embed">@k9campout.com</a>) <a href="https://bsky.app/profile/did:plc:fqgm57geg7cilwyz5keaxzdn/post/3lgw45wt6bs2x?ref_src=embed">January 29, 2025 at 3:18 PM</a></blockquote><script async src="https://embed.bsky.app/static/embed.js" charset="utf-8"></script>


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