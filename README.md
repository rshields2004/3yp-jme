This is my third year project; Junction Modeller Expanded

## Quick rundown

At the moment I have a junction context that wraps around the control panel and R3F scene and provides state to each.

It works by using two different types of state: the JunctionConfig state which stores the physical information about how the junction is displayed. And the other
attributes e.g., numExits which are tracked to ensure the JunctionConfig state is updated correctly


