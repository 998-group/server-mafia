const generateRandomNumber = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;
const generateRole = (room) => {
    console.log("GenerateROles", room)
    if(room.players.length >= 9) {
        room.players.forEach((player, index) => {
            player.gameRole = "peacefull"
        })

        room.players[generateRandomNumber(0, room.players.length)].gameRole = "mafia"
        room.players[generateRandomNumber(0, room.players.length)].gameRole = "mafia"
        room.players[generateRandomNumber(0, room.players.length)].gameRole = "mafia"
        room.players[generateRandomNumber(0, room.players.length)].gameRole = "doctor"
        room.players[generateRandomNumber(0, room.players.length)].gameRole = "detective"
    } else if (room.players.length >= 6) {
        room.players.forEach((player, index) => {
            player.gameRole = "peacefull"
        })
        room.players[generateRandomNumber(0, room.players.length)].gameRole = "mafia"
        room.players[generateRandomNumber(0, room.players.length)].gameRole = "mafia"
        room.players[generateRandomNumber(0, room.players.length)].gameRole = "doctor"
        room.players[generateRandomNumber(0, room.players.length)].gameRole = "detective"
    } else if (room.players.length >= 3) {
        room.players.forEach((player, index) => {
            player.gameRole = "peacefull"
        })
        room.players[generateRandomNumber(0, room.players.length)].gameRole = "mafia"
        room.players[generateRandomNumber(0, room.players.length)].gameRole = "doctor"
    }

}

export default generateRole;