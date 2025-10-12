function nix-rebuild -d "Rebuild nix darwin"
  sudo darwin-rebuild switch --flake ~/nix#macbook-Szymon
end
