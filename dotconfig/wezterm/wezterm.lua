local wezterm = require 'wezterm';

wezterm.on("open-config", function(window, pane)
    wezterm.action{ActivateTabRelative=-1}
end);

return {
  --font = wezterm.font("Cica"),
  use_ime = true,
  font_size = 14.0,
  color_scheme = "OneHalfDark",
  hide_tab_bar_if_only_one_tab = true,
  adjust_window_size_when_changing_font_size = false,
  keys = {
      {key="{", mods="CTRL", action=wezterm.action{EmitEvent="open-config"}},
  }
}
