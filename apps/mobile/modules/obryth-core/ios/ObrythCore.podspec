Pod::Spec.new do |s|
  s.name = 'ObrythCore'
  s.version = '0.1.0'
  s.summary = 'Obryth shared Rust vault through UniFFI'
  s.description = s.summary
  s.license = { :type => 'MIT' }
  s.author = 'Obryth'
  s.homepage = 'https://github.com/obryth'
  s.source = { :path => '.' }
  s.platform = :ios, '16.4'
  s.swift_version = '5.9'
  s.dependency 'ExpoModulesCore'
  s.source_files = '**/*.{swift,h,m,mm}'
  s.vendored_frameworks = 'ObrythMobile.xcframework'
  s.pod_target_xcconfig = { 'DEFINES_MODULE' => 'YES', 'SWIFT_INCLUDE_PATHS' => '$(PODS_TARGET_SRCROOT)/generated' }
end
