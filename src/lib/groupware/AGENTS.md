# GroupWare
- Rides the existing mesh 'groupware' channel and Global Cell roles; hosts relay storage ops and never share server URLs or credentials — keeps member access revocable and secrets local.
- Hosts may advertise only a credential-free public HTTPS SWARM RPC URL in their ad; clients re-sanitize it and preflight eth_chainId before asking MetaMask — so peer relays replace the desktop companion without leaking storage secrets.
