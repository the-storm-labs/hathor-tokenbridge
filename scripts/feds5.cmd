:loop
node fed.js main http://localhost:8545 side http://localhost:8545 0
node fed.js main http://localhost:8545 side http://localhost:8545 1
node fed.js main http://localhost:8545 side http://localhost:8545 2
node fed.js main http://localhost:8545 side http://localhost:8545 3
node fed.js main http://localhost:8545 side http://localhost:8545 4

node fed.js side http://localhost:8545 main http://localhost:8545 0
node fed.js side http://localhost:8545 main http://localhost:8545 1
node fed.js side http://localhost:8545 main http://localhost:8545 2
node fed.js side http://localhost:8545 main http://localhost:8545 3
node fed.js side http://localhost:8545 main http://localhost:8545 4

goto loop