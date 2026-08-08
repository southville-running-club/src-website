"""Post-switch monitor. Run any time during the 48-hour window.

Checks three things:
  1. Has the registry delegation changed to Cloudflare?
  2. Do Fasthosts and Cloudflare still agree on every record?
  3. Do public resolvers still return Squarespace for the apex (nothing proxied)?
"""
import subprocess, datetime

D = "southvillerunningclub.co.uk"
OLD, NEW = "ns1.livedns.co.uk", "bonnie.ns.cloudflare.com"
RESOLVERS = ["1.1.1.1", "8.8.8.8", "9.9.9.9", "208.67.222.222"]
SQUARESPACE = {"198.185.159.144", "198.185.159.145", "198.49.23.144", "198.49.23.145"}

CHECKS = [("@", "A"), ("www", "CNAME"), ("mail", "A"), ("mailserver", "A"),
          ("smtp", "A"), ("webmail", "A"), ("mcp", "A"), ("@", "MX"),
          ("@", "TXT"), ("_dmarc", "TXT"), ("9sw9cgfs3d8e53r2xcx5", "CNAME"),
          ("livemail1._domainkey", "CNAME"), ("livemail2._domainkey", "CNAME"),
          ("livemail3._domainkey", "CNAME"), ("livemail4._domainkey", "CNAME")]

def dig(server, name, rr):
    fqdn = D if name == "@" else name + "." + D
    r = subprocess.run(["dig", "@" + server, "+short", fqdn, rr],
                       capture_output=True, text=True, timeout=20)
    return " | ".join(sorted(x for x in r.stdout.strip().split("\n") if x))

print("=== %s UTC ===" % datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%d %H:%M"))

# 1. delegation at the registry
# NOTE: a registry server returns the delegation in the AUTHORITY section,
# not the answer section, so +short reads empty. Use +noall +authority.
r = subprocess.run(["dig", "@dns1.nic.uk", D, "NS", "+noall", "+authority"],
                   capture_output=True, text=True, timeout=20)
ns = sorted(line.split()[-1] for line in r.stdout.split("\n")
            if "\tNS\t" in line and not line.startswith(";"))
on_cf = any("cloudflare" in n for n in ns)
print("\n1. REGISTRY DELEGATION: %s" % ("CLOUDFLARE" if on_cf else "still Fasthosts"))
for n in ns:
    print("     " + n)

# 2. both zones still agree
bad = [(n, t) for n, t in CHECKS if dig(OLD, n, t) != dig(NEW, n, t)]
print("\n2. ZONES AGREE: %s (%d/%d records match)"
      % ("YES" if not bad else "*** NO ***", len(CHECKS) - len(bad), len(CHECKS)))
for n, t in bad:
    print("     DIFFERS: %s %s" % (n, t))
    print("       fasthosts : " + (dig(OLD, n, t) or "<none>"))
    print("       cloudflare: " + (dig(NEW, n, t) or "<none>"))

# 3. public resolvers -- and nothing proxied
print("\n3. PUBLIC RESOLVERS (apex must be Squarespace, never 104.x/172.6x):")
for res in RESOLVERS:
    got = set(x for x in dig(res, "@", "A").split(" | ") if x)
    if got == SQUARESPACE:
        state = "OK  Squarespace"
    elif any(g.startswith(("104.", "172.6", "172.7")) for g in got):
        state = "*** PROXIED -- FIX AT CLOUDFLARE NOW ***"
    else:
        state = "*** UNEXPECTED: %s ***" % sorted(got)
    print("     %-16s %s" % (res, state))

print("\nMail check is manual: send AND receive on a club address.")
