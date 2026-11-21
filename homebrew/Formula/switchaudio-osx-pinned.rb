# switchaudio-osx を版と sha256 で固定したもの（homebrew/core の formula を元にした）。
# 作者のアカウントが乗っ取られて別物の新しい版が出ても、ここを書き換えない限り入らない。
# 版を上げるときは、新しい版の中身を確かめてから url と sha256 を手で書き換える。
class SwitchaudioOsxPinned < Formula
  desc "Change macOS audio source from the command-line (pinned version)"
  homepage "https://github.com/deweller/switchaudio-osx/"
  url "https://github.com/deweller/switchaudio-osx/archive/refs/tags/1.2.2.tar.gz"
  sha256 "3d12b57cbd6063a643a12f12287af99c87894c33449c6bcac0a71fd15776b3ed"
  version "1.2.2"
  license "MIT"

  depends_on xcode: :build
  depends_on :macos

  conflicts_with "switchaudio-osx", because: "both install SwitchAudioSource"

  def install
    xcodebuild "-project", "AudioSwitcher.xcodeproj",
               "-target", "SwitchAudioSource",
               "SYMROOT=build",
               "-arch", Hardware::CPU.arch,
               "MACOSX_DEPLOYMENT_TARGET=#{MacOS.version}"
    prefix.install Dir["build/Release/*"]
    bin.write_exec_script "#{prefix}/SwitchAudioSource"
    chmod 0755, bin/"SwitchAudioSource"
  end

  test do
    system bin/"SwitchAudioSource", "-c"
  end
end
