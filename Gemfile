source "https://rubygems.org"

gem "webrick"
gem "github-pages", group: :jekyll_plugins

# liquid 4.0.3 calls String#tainted?, removed in Ruby 3.2+, which breaks the
# build on our Ruby 3.3 CI. 4.0.4 dropped that call, so require it at minimum.
gem "liquid", ">= 4.0.4"

gem "tzinfo-data"
gem "wdm", "~> 0.1.0" if Gem.win_platform?

# If you have any plugins, put them here!
group :jekyll_plugins do
  gem "jekyll-paginate"
  gem "jekyll-sitemap"
  gem "jekyll-gist"
  gem "jekyll-feed"
  gem "jemoji"
  gem "jekyll-include-cache"
  gem "jekyll-algolia"
  gem "faraday-retry"
end
