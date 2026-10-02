#!/bin/sh
# Runs add-sources.rb with the Ruby and xcodeproj gem that ship with CocoaPods.
cd "$(dirname "$0")/../App" || exit 1
POD_HOME="$(dirname "$(dirname "$(readlink -f "$(command -v pod)")")")/libexec"
RUBY="$(head -1 "$POD_HOME/bin/pod" | sed 's/^#!//')"
LANG=en_US.UTF-8 GEM_PATH="$POD_HOME:$("$RUBY" -e "print Gem.default_dir")" exec "$RUBY" ../scripts/add-sources.rb "$@"
