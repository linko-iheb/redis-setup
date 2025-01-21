# step1: open Docker desktop app

# step2: build docker image  / To be executed just one time or after code update

docker build -t redis-parse .

# step3: how to run docker container  / I can later run it from docker desktop

docker run -d -p 3001:3001 6379:6379 

