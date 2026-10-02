# Adds Swift files under ios/App/App to the App target (Capacitor's project
# has no folder sync). Idempotent: files already in the project are skipped.
# Usage: ios/scripts/add-sources.sh App/SMCViewController.swift App/Player/*.swift
require 'xcodeproj'
proj_path = File.expand_path('../App/App.xcodeproj', __dir__)
proj = Xcodeproj::Project.open(proj_path)
target = proj.targets.find { |t| t.name == 'App' }
app_group = proj.main_group['App']
ARGV.each do |rel|
  rel = rel.sub(%r{\AApp/}, '')
  parts = rel.split('/')
  group = parts[0..-2].reduce(app_group) { |g, name| g[name] || g.new_group(name, name) }
  next if group.files.any? { |f| f.path == parts.last }
  ref = group.new_reference(parts.last)
  target.source_build_phase.add_file_reference(ref)
  puts "added #{rel}"
end
proj.save
